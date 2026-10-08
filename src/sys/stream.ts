/** Write side of a character stream. Write boundaries carry no meaning. */
export interface OutputStream {
  write(data: string): void
}

/** Read side of a character stream. */
export interface InputStream {
  subscribe(listener: (data: string) => void): () => void
}

export interface Pipe extends OutputStream, InputStream {}

class PipeImpl implements Pipe {
  private readonly listeners = new Set<(data: string) => void>()

  write(data: string): void {
    for (const listener of [...this.listeners]) listener(data)
  }

  subscribe(listener: (data: string) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export function createPipe(): Pipe {
  return new PipeImpl()
}
