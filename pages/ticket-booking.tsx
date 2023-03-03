import { HasLayout } from '@/components/Shared/HasLayout'
import { NextPage } from 'next'
import React from 'react'
import Layout from '@/components/Shared/Layout';
import axios from 'axios';
import { Box, Grid } from '@mui/material';
import FlightCard from '@/components/Shared/FlightCard';
// import MockFlights from '@/data/mock-response.json';

const TicketBooking: NextPage & HasLayout = (props: any) => {
  // console.log(props);

  // console.log(MockFlights.itineraries.results);
  // console.log(MockFlights.itineraries.results);
  // console.log(MockFlights.itineraries.results[0].legs[0]);
  // console.log(MockFlights.itineraries.results[0].legs[0].arrival);
  // console.log(MockFlights.itineraries.results[0].legs[0].stopCount);

  // if (props.status === '1') {
  //     console.log('No data provided');
  // }

  const flightMap = props?.data?.itineraries?.results;

  return (
    <div className="grid grid-cols-12">
      <div className="col-span-2">
        <div className="mt-5">
          <p>Sidebar</p>
        </div>
      </div>
      <div className="col-span-8">
        <Box>
          {props.status === '0' ? (
            <Grid container spacing={2} p={5} mt={5}>
              {!flightMap.length ? (
                  <p>No Flights Found</p>
              ) : (
                <>
                  {flightMap?.map((flight: any) => (
                    <FlightCard key={flight.id} flight={flight} />
                  ))}
                </>
              )}
            </Grid>
          ) : (
            <p>No data provided</p>
          )}
        </Box>
      </div>
      <div className="col-span-2">
        <div className="mt-5">
          <p>Ads Section</p>
        </div>
      </div>
    </div>
  )
}

export async function getServerSideProps(context: any) {
  const url = process.env.RAPID_API_HOST;
  const key = process.env.RAPID_API_KEY;

  if(!context.query.persons || !context.query.departure || !context.query.departureDate) {
    return {
      props: { status: '1'}
    }
  }

  const getFlights = await axios.request({
      url: `https://${url}/search-extended`,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        'X-RapidAPI-Key': `${key}`,
        'X-RapidAPI-Host': `${url}`
      },
      params: {
        adults: context.query.persons,
        origin: context.query.departure,
        destination: context.query.returning,
        departureDate: context.query.departureDate,
        returnDate: context.query.returningDate || '',
      }
    }
  );

  console.log(getFlights.data);

  return {
    props: { data: getFlights.data, status: '0' },
  }
}

TicketBooking.getLayout = (page) => <Layout>{page}</Layout>;
export default TicketBooking;