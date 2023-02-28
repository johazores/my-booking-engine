import { FC, SVGProps } from 'react';
export const Notification: FC<SVGProps<SVGSVGElement>> = ({ ...props }) => (
<svg xmlns="http://www.w3.org/2000/svg"
  fill="#5f5f5f"
  width="12.5"
  height="15"
  viewBox="0 0 12.5 15"
  { ...props }
  >
    <g transform="translate(-42.675)">
      <g transform="translate(42.675)">
      <path className="a" d="M55.13,12.272l-1.073-1.735A5.037,5.037,0,0,1,53.3,7.885V6.365A4.268,4.268,0,0,0,50.175,2.3V1.212a1.251,1.251,0,0,0-2.5,0V2.3A4.268,4.268,0,0,0,44.55,6.365v1.52a5.04,5.04,0,0,1-.757,2.651L42.72,12.271a.3.3,0,0,0,0,.306.313.313,0,0,0,.271.154H54.862a.315.315,0,0,0,.272-.153A.3.3,0,0,0,55.13,12.272Z" transform="translate(-42.675)"/>
      </g>
      <g transform="translate(46.543 13.487)">
        <path className="a" d="M188.815,469.333a2.632,2.632,0,0,0,4.764,0Z" transform="translate(-188.815 -469.333)"/>
      </g>
    </g>
</svg>
);
