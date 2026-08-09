// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'

import { InlineEditField } from './InlineEditField'

afterEach(cleanup)

describe('InlineEditField', () => {
  it('renders the value and stays read-only until the pencil is clicked', () => {
    render(<InlineEditField value="Auth System" onSave={vi.fn()} ariaLabel="project name" />)

    expect(screen.getByText('Auth System')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('enters edit mode on pencil click and saves the trimmed value on Enter', () => {
    const onSave = vi.fn()
    render(<InlineEditField value="Auth System" onSave={onSave} ariaLabel="project name" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit project name' }))
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  New Name  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSave).toHaveBeenCalledWith('New Name')
  })

  it('saves on blur', () => {
    const onSave = vi.fn()
    render(<InlineEditField value="Auth System" onSave={onSave} ariaLabel="project name" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit project name' }))
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Blurred Name' } })
    fireEvent.blur(input)

    expect(onSave).toHaveBeenCalledWith('Blurred Name')
  })

  it('discards the draft and does not save on Escape', () => {
    const onSave = vi.fn()
    render(<InlineEditField value="Auth System" onSave={onSave} ariaLabel="project name" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit project name' }))
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Discarded Name' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Auth System')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('does not save an empty or whitespace-only value', () => {
    const onSave = vi.fn()
    render(<InlineEditField value="Auth System" onSave={onSave} ariaLabel="project name" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit project name' }))
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('does not call onSave when the trimmed value is unchanged', () => {
    const onSave = vi.fn()
    render(<InlineEditField value="Auth System" onSave={onSave} ariaLabel="project name" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit project name' }))
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('carries the display className onto the input so text size does not shift while editing', () => {
    render(
      <InlineEditField
        value="Auth System"
        onSave={vi.fn()}
        ariaLabel="project name"
        className="text-2xl font-semibold"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit project name' }))
    const input = screen.getByRole('textbox') as HTMLInputElement

    expect(input.className).toContain('text-2xl')
    expect(input.className).toContain('font-semibold')
  })
})
