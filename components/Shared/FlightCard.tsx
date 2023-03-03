import { Grid } from '@mui/material'
import React from 'react'
import Image from 'next/image';
import moment from 'moment';

interface FlightProps {
  flight: any;
}
const FlightCard = ({ flight } : FlightProps) => {
  const duration = moment.utc().startOf('day').add({ minutes: flight?.legs[0]?.durationInMinutes });
  const segments = flight?.legs[0].segments;
  const arrival = flight?.legs[0].arrival;
  const departure = flight?.legs[0].departure;
  return (
    <Grid item xs={12}>
      <div className="border border-gray-400 rounded-md mt-4 mb-4">
        <div className="grid grid-cols-12">
          <div className="col-span-10  border-gray-400 pt-3 pb-3 pl-6 pr-2 flex items-center justify-start">
            <p>{flight?.legs[0]?.stopCount} Stops {`${moment(duration).format('H')} Hours ${moment(duration).format('mm')} mins`} </p>
          </div>
          <div className="col-span-2 border-l border-gray-400 pt-3 pb-3 pl-2 pr-2 flex items-center justify-center">
            <p>ECONOMY CLASSIC</p>
          </div>
          <div className="col-span-10 border-t border-gray-400 p-6">
            <div className="grid grid-cols-12">
              <div className="col-span-2">
                <Image
                  width={121}
                  height={35}
                  src="/images/flight.png"
                  alt="Logo"
                />
              </div>
              <div className="col-span-2 flex items-center justify-center">
                <div>
                  <p>{moment(departure).format('HH')} Hours</p>
                  <p>{flight?.legs[0]?.origin?.displayCode}</p>
                </div>
              </div>
              <div className="col-span-4 flex items-center justify-center">
                <div className="grid grid-cols-12 gap-x-4">
                  {segments.map((seg: any) => (
                    <div key={seg.id} className="col-span-6">
                      <p>{seg?.durationInMinutes} mins</p>
                      <p>{seg?.destination?.flightPlaceId}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="col-span-2 flex items-center justify-center">
                <div>
                  <p>{moment(arrival).format('HH')} Hours</p>
                  <p>{flight?.legs[0]?.destination?.displayCode}</p>
                </div>
              </div>
            </div>

          </div>
          <div className="col-span-2 border-l border-t border-gray-400 p-6 flex items-center justify-center flex-col">
            <p className="text-red-600 font-bold text-xl">${flight.pricing_options[0].price.amount}</p>
            <p>Round-trip</p>
          </div>
        </div>
      </div>
    </Grid>
  )
}

export default FlightCard