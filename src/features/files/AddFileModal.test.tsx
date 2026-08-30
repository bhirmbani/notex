// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { AddFileModal } from './AddFileModal'
import { useCreateFile } from './hooks'

vi.mock('./hooks', () => ({
  useCreateFile: vi.fn(),
}))

const mockedUseCreateFile = vi.mocked(useCreateFile)

afterEach(cleanup)

function setupCreate(mutateAsync: ReturnType<typeof vi.fn>) {
  mockedUseCreateFile.mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateFile>)
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('AddFileModal', () => {
  it('shows an error and re-enables the button when the upload mutation rejects', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('network error'))
    setupCreate(mutateAsync)
    const onClose = vi.fn()
    const { container } = render(
      <AddFileModal organizationId="org-1" contextId="ctx-1" onClose={onClose} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } })

    const submitButton = container.querySelector('form button[type="submit"]') as HTMLButtonElement
    fireEvent.click(submitButton)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(submitButton.disabled).toBe(false)
    expect(submitButton.textContent).toBe('Upload')
  })

  it('shows an error instead of an unhandled rejection when the text mutation rejects', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('network error'))
    setupCreate(mutateAsync)
    const onClose = vi.fn()
    const { container } = render(
      <AddFileModal organizationId="org-1" contextId="ctx-1" onClose={onClose} />,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'README.md' } })
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'hello world' } })

    const submitButton = container.querySelector('form button[type="submit"]') as HTMLButtonElement
    fireEvent.click(submitButton)
    await flush()

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows an error and re-enables the button when the file cannot be read', async () => {
    const mutateAsync = vi.fn()
    setupCreate(mutateAsync)
    const onClose = vi.fn()
    const { container } = render(
      <AddFileModal organizationId="org-1" contextId="ctx-1" onClose={onClose} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } })

    // Force FileReader to fail instead of succeed, simulating an unreadable file.
    const originalReadAsDataURL = FileReader.prototype.readAsDataURL
    FileReader.prototype.readAsDataURL = function (this: FileReader) {
      this.dispatchEvent(new Event('error'))
    }

    const submitButton = container.querySelector('form button[type="submit"]') as HTMLButtonElement
    fireEvent.click(submitButton)
    await flush()

    FileReader.prototype.readAsDataURL = originalReadAsDataURL

    expect(mutateAsync).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(submitButton.disabled).toBe(false)
  })

  it('clears the previous error and closes the modal once a retry succeeds', async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ id: 'file-1' })
    setupCreate(mutateAsync)
    const onClose = vi.fn()
    const { container } = render(
      <AddFileModal organizationId="org-1" contextId="ctx-1" onClose={onClose} />,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'README.md' } })
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'hello world' } })
    const submitButton = container.querySelector('form button[type="submit"]') as HTMLButtonElement

    fireEvent.click(submitButton)
    await flush()
    expect(screen.getByRole('alert')).toBeTruthy()

    fireEvent.click(submitButton)
    await flush()

    expect(mutateAsync).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
