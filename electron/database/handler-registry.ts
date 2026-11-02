export interface IpcHandlerEvent {
  sender: unknown
}

export type IpcRequestHandler = (event: IpcHandlerEvent, value?: unknown) => unknown

export interface IpcHandlerRegistry {
  handle(channel: string, handler: IpcRequestHandler): void
  removeHandler(channel: string): void
}
