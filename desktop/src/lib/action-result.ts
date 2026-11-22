export type ActionSuccess<T> = {
  ok: true
  data: T
}

export type ActionFailure = {
  ok: false
  error: string
  fieldErrors?: Record<string, string[]>
}

export type ActionResult<T> = ActionSuccess<T> | ActionFailure

export function ok<T>(data: T): ActionSuccess<T> {
  return { ok: true, data }
}

export function err(
  error: string,
  fieldErrors?: Record<string, string[]>
): ActionFailure {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error }
}

export function isOk<T>(result: ActionResult<T>): result is ActionSuccess<T> {
  return result.ok
}

export function isErr<T>(result: ActionResult<T>): result is ActionFailure {
  return !result.ok
}
