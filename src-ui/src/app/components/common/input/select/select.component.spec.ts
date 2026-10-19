import { ComponentFixture, TestBed } from '@angular/core/testing'
import {
  FormsModule,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
} from '@angular/forms'
import { RouterTestingModule } from '@angular/router/testing'
import { NgSelectModule } from '@ng-select/ng-select'
import {
  DEFAULT_MATCHING_ALGORITHM,
  MATCH_ALL,
} from 'src/app/data/matching-model'
import { Tag } from 'src/app/data/tag'
import { SelectComponent } from './select.component'

const items: Tag[] = [
  {
    id: 1,
    name: 'Tag1',
    is_inbox_tag: false,
    matching_algorithm: DEFAULT_MATCHING_ALGORITHM,
  },
  {
    id: 2,
    name: 'Tag2',
    is_inbox_tag: true,
    matching_algorithm: MATCH_ALL,
    match: 'str',
  },
  {
    id: 10,
    name: 'Tag10',
    is_inbox_tag: false,
    matching_algorithm: DEFAULT_MATCHING_ALGORITHM,
  },
]

describe('SelectComponent', () => {
  let component: SelectComponent
  let fixture: ComponentFixture<SelectComponent>
  let input: HTMLInputElement

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [],
      imports: [
        FormsModule,
        ReactiveFormsModule,
        NgSelectModule,
        RouterTestingModule,
        SelectComponent,
      ],
    }).compileComponents()

    fixture = TestBed.createComponent(SelectComponent)
    fixture.debugElement.injector.get(NG_VALUE_ACCESSOR)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('shows the reason for an alternative without selecting it', () => {
    component.items = items
    component.value = 1
    component.suggestions = [1, 2, 999]
    component.suggestionDetails = { 2: 'Paperless matching' }
    fixture.changeDetectorRef.markForCheck()
    fixture.detectChanges()
    const link = fixture.nativeElement.querySelector(
      'a[title="Paperless matching"]'
    )
    expect(link?.textContent).toBe('Tag2')
    expect(component.value).toBe(1)
    expect(component.getSuggestions().map((item) => item.id)).toEqual([2])
  })

  it('should support private items', () => {
    component.value = 3
    component.items = items
    expect(component.items).toContainEqual({
      id: 3,
      name: 'Private',
      private: true,
    })

    component.checkForPrivateItems([4, 5])
    expect(component.items).toContainEqual({
      id: 4,
      name: 'Private',
      private: true,
    })
    expect(component.items).toContainEqual({
      id: 5,
      name: 'Private',
      private: true,
    })
  })

  it('should support suggestions', () => {
    expect(component.value).toBeUndefined()
    component.items = items
    component.suggestions = [1, 2]
    fixture.detectChanges()
    const suggestionAnchor: HTMLAnchorElement =
      fixture.nativeElement.querySelector('a')
    suggestionAnchor.click()
    expect(component.value).toEqual(1)
  })

  it('should support create new and emit the value', () => {
    expect(component.allowCreateNew).toBeFalsy()
    component.items = items
    let createNewVal
    component.createNew.subscribe((v) => (createNewVal = v))
    expect(component.allowCreateNew).toBeTruthy()
    component.onSearch({ term: 'foo' })
    component.addItem(undefined)
    expect(createNewVal).toEqual('foo')
    component.addItem('bar')
    expect(createNewVal).toEqual('bar')
    component.onSearch({ term: 'baz' })
    component.clickNew()
    expect(createNewVal).toEqual('baz')
  })

  it('should search items by independent normalized terms', () => {
    expect(
      component.searchFn('tax 26', { id: 11, name: 'Tax\u00e9s 2026' })
    ).toBeTruthy()
    expect(
      component.searchFn('tax receipt', { id: 11, name: 'Tax\u00e9s 2026' })
    ).toBeFalsy()
  })

  it('should clear search term on blur after delay', () => {
    jest.useFakeTimers()
    const clearSpy = jest.spyOn(component, 'clearLastSearchTerm')
    component.onBlur()
    jest.advanceTimersByTime(3000)
    expect(clearSpy).toHaveBeenCalled()
    jest.useRealTimers()
  })

  it('should emit filtered documents', () => {
    component.value = 10
    component.items = items
    const emitSpy = jest.spyOn(component.filterDocuments, 'emit')
    component.onFilterDocuments()
    expect(emitSpy).toHaveBeenCalledWith([items[2]])
  })

  it('should return the correct filter button title', () => {
    component.title = 'Tag'
    const expectedTitle = `Filter documents with this ${component.title}`
    expect(component.filterButtonTitle).toEqual(expectedTitle)
  })
})
