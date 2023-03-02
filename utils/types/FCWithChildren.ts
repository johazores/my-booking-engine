/**
 * Because React remove `children` from FC typings which is slightly annoying.
 *
 * RFC - React Function Component xD
 */

import { FC, ReactNode } from 'react';
export type RFC<P = {}> = FC<P & WithChild>;

export type WithChild = { children?: ReactNode };
