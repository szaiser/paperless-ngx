class LLMTimeoutError(Exception):
    pass


class LLMProviderError(Exception):
    """The LLM backend rejected the request."""


class SuggestionProviderError(Exception):
    """Provider failed; messages exclude response bodies and credentials."""


class SuggestionProviderUnavailable(SuggestionProviderError):
    """A transport failure or retryable HTTP response."""


class SuggestionCatalogUnavailable(SuggestionProviderError):
    """An explicit provider catalog error safe to show to its authenticated user."""


class StaleSuggestions(SuggestionProviderError):
    """Document state changed while suggestions were being generated."""
