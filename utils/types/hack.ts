// eslint-disable-next-line no-unused-vars
export default function asyncComponent<T, R>(fn: (arg: T) => Promise<R>): (arg: T) => R {
  // eslint-disable-next-line no-unused-vars
  return fn as (arg: T) => R;
}
