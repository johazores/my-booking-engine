import { FC, SVGProps } from 'react';
export const Events: FC<SVGProps<SVGSVGElement>> = ({ ...props }) => (
<svg xmlns="http://www.w3.org/2000/svg"
  fill="#5f5f5f"
  width="15"
  height="15"
  viewBox="0 0 15 15"
  { ...props }
  >
<g transform="translate(-4.5 -2.25)"><path className="a" d="M18.829,4.351A1.129,1.129,0,0,0,17.635,3.3H15.247V2.25H14.053V3.3H9.276V2.25H8.082V3.3H5.694A1.129,1.129,0,0,0,4.5,4.351V14.857a1.129,1.129,0,0,0,1.194,1.051H8.082V14.857H5.694V4.351H8.082V5.4H9.276V4.351h4.776V5.4h1.194V4.351h2.388V7.5h1.194Z"/><path className="a" d="M19.993,16.875,21.7,20.188l3.657.531L22.677,23.3l.671,3.642-3.355-1.719L16.638,26.94l.671-3.641L14.625,20.72l3.758-.531Z" transform="translate(-5.861 -9.69)"/></g>
</svg>
);
