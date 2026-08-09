// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  it('shows an error and stays in edit mode with the draft preserved when onSave fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('network error'))
    render(<InlineEditField value="Auth System" onSave={onSave} ariaLabel="project name" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit project name' }))
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New Name' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      await Promise.resolve()
    })

    expect(onSave).toHaveBeenCalledWith('New Name')
    expect(screen.getByRole('alert').textContent).toMatch(/could not save/i)
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('New Name')
  })

  it('clears the error and exits edit mode once a retry succeeds', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce(undefined)
    render(<InlineEditField value="Auth System" onSave={onSave} ariaLabel="project name" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit project name' }))
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New Name' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      await Promise.resolve()
    })
    expect(screen.getByRole('alert')).toBeTruthy()

    await act(async () => {
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
      await Promise.resolve()
    })

    expect(onSave).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('clears a previous error when editing is discarded via Escape', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('network error'))
    render(<InlineEditField value="Auth System" onSave={onSave} ariaLabel="project name" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit project name' }))
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New Name' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      await Promise.resolve()
    })
    expect(screen.getByRole('alert')).toBeTruthy()

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Auth System')).toBeTruthy()
  })

  it('ignores a second commit fired while the first save is still pending', async () => {
    let resolveSave: () => void = () => {}
    const onSave = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        }),
    )
    render(<InlineEditField value="Auth System" onSave={onSave} ariaLabel="project name" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit project name' }))
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New Name' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(screen.getByRole('textbox'))

    expect(onSave).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSave()
      await Promise.resolve()
    })
  })

  it('ignores Escape while a save is still pending, keeping the draft and edit mode', async () => {
    let resolveSave: () => void = () => {}
    const onSave = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        }),
    )
    render(<InlineEditField value="Auth System" onSave={onSave} ariaLabel="project name" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit project name' }))
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New Name' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

    expect(screen.getByRole('textbox')).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('New Name')

    await act(async () => {
      resolveSave()
      await Promise.resolve()
    })
  })
})
