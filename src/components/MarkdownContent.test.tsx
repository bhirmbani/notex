// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { MarkdownContent } from './MarkdownContent'

afterEach(cleanup)

describe('MarkdownContent', () => {
  it('renders bold text as a strong element, not literal asterisks', () => {
    render(<MarkdownContent content="This is **bold** text." />)

    const strong = screen.getByText('bold')
    expect(strong.tagName).toBe('STRONG')
    expect(screen.queryByText('**bold**')).toBeNull()
  })

  it('renders inline code as a code element', () => {
    render(<MarkdownContent content="Use `npm install` to set up." />)

    const code = screen.getByText('npm install')
    expect(code.tagName).toBe('CODE')
  })

  it('renders bullet lists as list items', () => {
    render(<MarkdownContent content={'- first\n- second'} />)

    expect(screen.getByRole('list')).toBeTruthy()
    expect(screen.getAllByRole('listitem').map((el) => el.textContent)).toEqual(['first', 'second'])
  })

  it('renders a horizontal rule for ---', () => {
    const { container } = render(<MarkdownContent content={'above\n\n---\n\nbelow'} />)

    expect(container.querySelector('hr')).toBeTruthy()
  })

  it('renders headers as heading elements', () => {
    render(<MarkdownContent content="## Section" />)

    expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeTruthy()
  })

  it('does not render raw HTML tags unsanitized', () => {
    const { container } = render(<MarkdownContent content='<img src=x onerror="window.__pwned = true">' />)

    expect(container.querySelector('img')).toBeNull()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('does not execute or render a raw script tag', () => {
    const { container } = render(
      <MarkdownContent content={'<script>window.__pwned = true</script>'} />,
    )

    expect(container.querySelector('script')).toBeNull()
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('preserves single line breaks in plain, non-blank-line-separated text', () => {
    const { container } = render(<MarkdownContent content={'line one\nline two\nline three'} />)

    const paragraph = container.querySelector('p')
    expect(paragraph?.querySelectorAll('br').length).toBe(2)
  })

  it('does not leak the internal AST node as a DOM attribute', () => {
    const { container } = render(<MarkdownContent content="**bold** text with `code` and a list\n\n- item" />)

    expect(container.innerHTML).not.toContain('node=')
  })
})
