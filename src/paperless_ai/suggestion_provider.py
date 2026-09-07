"""Document-aware HTTP boundary shared by native suggestions and workflows."""

import hashlib
import json
import socket
from typing import Any
from typing import Final

import httpx
from django.conf import settings
from django.contrib.auth.models import User
from django.core.serializers.json import DjangoJSONEncoder
from pydantic import ValidationError

from documents.classifier import load_classifier
from documents.matching import get_classic_document_suggestions
from documents.models import Correspondent
from documents.models import CustomFieldInstance
from documents.models import Document
from documents.models import DocumentType
from documents.models import StoragePath
from documents.models import Tag
from documents.permissions import restrict_queryset_to_visible
from documents.versioning import get_latest_version_for_root
from paperless.network import create_pinned_httpx_client
from paperless_ai.base_model import ClassificationSuggestions
from paperless_ai.base_model import validate_classification_suggestions
from paperless_ai.db import db_connection_released
from paperless_ai.exceptions import StaleSuggestions
from paperless_ai.exceptions import SuggestionProviderError
from paperless_ai.exceptions import SuggestionProviderUnavailable

PROTOCOL_VERSION: Final = 1
MAX_RESPONSE_BYTES: Final = 1_048_576


TAXONOMY = {
    "tags": (Tag, "view_tag"),
    "correspondents": (Correspondent, "view_correspondent"),
    "document_types": (DocumentType, "view_documenttype"),
    "storage_paths": (StoragePath, "view_storagepath"),
}


def fingerprint(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, cls=DjangoJSONEncoder).encode(),
    ).hexdigest()


def document_snapshot(document: Document) -> dict[str, Any]:
    """Saved metadata plus the actual source version of the effective Content."""
    source = (
        get_latest_version_for_root(document)
        if document.root_document_id is None
        else document
    )
    snapshot = {
        "id": document.pk,
        "root_document_id": document.root_document_id,
        "owner_id": document.owner_id,
        "modified": document.modified,
        "title": document.title,
        "created": document.created,
        "correspondent": document.correspondent_id,
        "document_type": document.document_type_id,
        "storage_path": document.storage_path_id,
        "archive_serial_number": document.archive_serial_number,
        "tags": sorted(document.tags.values_list("pk", flat=True)),
        "custom_fields": [
            {
                "field": item.field_id,
                "name": item.field.name,
                "data_type": item.field.data_type,
                "value": item.value,
            }
            for item in CustomFieldInstance.objects.filter(document=document)
            .select_related("field")
            .order_by("field_id")
        ],
        "content": source.content,
        "content_version": {
            "id": source.pk,
            "version_index": source.version_index,
            "checksum": source.checksum,
            "archive_checksum": source.archive_checksum,
            "modified": source.modified,
            "mime_type": source.mime_type,
            "original_filename": source.original_filename,
        },
    }
    return json.loads(json.dumps(snapshot, cls=DjangoJSONEncoder))


def post_provider(payload: dict[str, Any]) -> dict[str, Any]:
    """Bounded, DNS-pinned HTTP call. Redirects and environment proxies are off."""
    headers = (
        {"Authorization": f"Bearer {settings.AI_SUGGESTIONS_API_KEY}"}
        if settings.AI_SUGGESTIONS_API_KEY
        else {}
    )
    try:
        with (
            db_connection_released(),
            create_pinned_httpx_client(
                settings.AI_SUGGESTIONS_ENDPOINT,
                allow_internal=settings.AI_SUGGESTIONS_ALLOW_INTERNAL_ENDPOINTS,
                timeout=settings.AI_SUGGESTIONS_REQUEST_TIMEOUT,
                follow_redirects=False,
                trust_env=False,
            ) as client,
            client.stream(
                "POST",
                settings.AI_SUGGESTIONS_ENDPOINT,
                json=payload,
                headers=headers,
            ) as response,
        ):
            if (
                response.status_code in {408, 409, 425, 429}
                or response.status_code >= 500
            ):
                raise SuggestionProviderUnavailable(
                    f"Suggestion provider temporarily unavailable (HTTP {response.status_code})",
                )
            if response.status_code != 200:
                raise SuggestionProviderError(
                    f"Suggestion provider rejected the request (HTTP {response.status_code})",
                )
            body = bytearray()
            for chunk in response.iter_bytes(chunk_size=65_536):
                body.extend(chunk)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise SuggestionProviderError(
                        "Suggestion provider response exceeds 1 MiB",
                    )
            value = json.loads(body)
            if not isinstance(value, dict):
                raise SuggestionProviderError(
                    "Suggestion provider returned an invalid response",
                )
            return value
    except httpx.TransportError:
        raise SuggestionProviderUnavailable(
            "Suggestion provider connection failed",
        ) from None
    except (ValueError, UnicodeError, httpx.DecodingError, httpx.InvalidURL) as exc:
        if isinstance(exc.__cause__, socket.gaierror):
            raise SuggestionProviderUnavailable(
                "Suggestion provider hostname resolution failed",
            ) from None
        raise SuggestionProviderError(
            "Invalid suggestion provider configuration or response",
        ) from None


def get_provider_classification(
    document: Document,
    user: User | None = None,
    output_language: str | None = None,
) -> ClassificationSuggestions:
    try:
        document.refresh_from_db(from_queryset=Document.objects.all())
    except Document.DoesNotExist:
        raise StaleSuggestions("Document no longer exists") from None
    snapshot = document_snapshot(document)
    taxonomy = {}
    classic = get_classic_document_suggestions(
        document,
        load_classifier(),
        user,
        content=snapshot["content"],
        filename=snapshot["content_version"]["original_filename"] or "",
    )
    for key, (model, permission) in TAXONOMY.items():
        taxonomy[key] = list(
            restrict_queryset_to_visible(
                model.objects.all(),
                user,
                permission,
            )
            .order_by("pk")
            .values("id", "name"),
        )
        allowed = {item["id"] for item in taxonomy[key]}
        classic[key] = [pk for pk in classic[key] if pk in allowed]
    context = {
        "document": snapshot,
        "requester_id": user.pk if user else None,
        "output_language": output_language,
        "taxonomy": taxonomy,
        "classic_suggestions": classic,
    }
    payload = {
        "protocol_version": PROTOCOL_VERSION,
        "context_id": fingerprint(context),
        **context,
    }
    try:
        suggestions = validate_classification_suggestions(post_provider(payload))
    except ValidationError:
        raise SuggestionProviderError(
            "Suggestion provider returned invalid suggestions",
        ) from None
    try:
        current = document_snapshot(Document.objects.get(pk=document.pk))
    except Document.DoesNotExist:
        raise StaleSuggestions("Document no longer exists") from None
    if current != snapshot:
        raise StaleSuggestions(
            "Document changed during suggestion generation; request suggestions again",
        )
    for key in ("tags", "correspondents", "document_types", "storage_paths"):
        allowed = {item["id"] for item in taxonomy[key]}
        if not set(suggestions[key]["existing_ids"]) <= allowed:
            raise SuggestionProviderError(
                "Suggestion provider returned an ID outside the permitted taxonomy",
            )
    return suggestions
