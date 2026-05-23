export type Success<T> = { readonly ok: true; readonly value: T };
export type Failure<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Success<T> | Failure<E>;

export function success<T>(value: T): Success<T> {
  return { ok: true, value };
}

export function failure<E>(error: E): Failure<E> {
  return { ok: false, error };
}

export async function traverseAsync<T, U, E>(items: ReadonlyArray<T>, fn: (item: T) => Promise<Result<U, E>>): Promise<Result<U[], E>> {
  const results: U[] = [];

  for (const item of items) {
    const result = await fn(item);

    if (!result.ok) {
      return result;
    }

    results.push(result.value);
  }

  return success(results);
}

export function firstFailure<E>(...results: ReadonlyArray<Result<unknown, E>>): Result<void, E> {
  for (const result of results) {
    if (!result.ok) {
      return result;
    }
  }

  return success(undefined);
}
