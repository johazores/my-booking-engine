import { ReactNode } from 'react';

/* eslint-disable no-unused-vars */
export type GetLayout = (page: ReactNode, props?: unknown) => ReactNode;

export interface HasLayout {
  getLayout?: GetLayout;
}
