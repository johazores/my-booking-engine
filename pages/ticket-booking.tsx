import type { GetServerSidePropsContext, NextPage } from 'next';
import Link from 'next/link';
import { Grid } from '@mui/material';
import { HasLayout } from '@/components/Shared/HasLayout';
import Layout from '@/components/Shared/Layout';
import FlightCard from '@/components/Shared/FlightCard';
import type { FlightOffer } from '@/src/domain/flight-search';
import {
  FlightSearchValidationError,
  parseFlightSearchRequest,
  searchFlights,
} from '@/src/application/search-flights';
import { FlightProviderError } from '@/src/integrations/travel/rapid-api-flight-provider';

interface TicketBookingProps {
  offers: FlightOffer[];
  origin: string;
  destination: string;
  error?: string;
}

const TicketBooking: NextPage<TicketBookingProps> & HasLayout = ({
  offers,
  origin,
  destination,
  error,
}) => (
  <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-medium text-red-600">Flight search</p>
        <h1 className="text-2xl font-bold text-gray-900">
          {origin} → {destination}
        </h1>
      </div>
      <Link className="text-sm font-medium text-red-600 hover:underline" href="/">
        Change search
      </Link>
    </div>

    {error ? (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5">
        <h2 className="font-semibold text-red-900">We could not search flights</h2>
        <p className="mt-1 text-sm text-red-800">{error}</p>
        <Link className="mt-4 inline-block font-medium text-red-700 hover:underline" href="/">
          Try another search
        </Link>
      </div>
    ) : offers.length === 0 ? (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
        <h2 className="font-semibold text-gray-900">No flights found</h2>
        <p className="mt-1 text-sm text-gray-600">
          Try different travel dates or another airport.
        </p>
      </div>
    ) : (
      <Grid container spacing={2}>
        {offers.map((flight) => (
          <FlightCard key={flight.id} flight={flight} />
        ))}
      </Grid>
    )}
  </main>
);

export async function getServerSideProps(context: GetServerSidePropsContext) {
  let request;

  try {
    request = parseFlightSearchRequest(context.query);
  } catch (error) {
    if (error instanceof FlightSearchValidationError) {
      return {
        redirect: {
          destination: '/',
          permanent: false,
        },
      };
    }

    throw error;
  }

  try {
    const result = await searchFlights(request);

    return {
      props: {
        offers: result.offers,
        origin: request.origin,
        destination: request.destination,
      },
    };
  } catch (error) {
    context.res.statusCode = error instanceof FlightProviderError ? 502 : 500;

    if (error instanceof FlightProviderError) {
      console.error('flight-search page provider failure', {
        providerId: error.providerId,
        code: error.code,
        status: error.status,
      });
    } else {
      console.error('flight-search page unexpected failure');
    }

    return {
      props: {
        offers: [],
        origin: request.origin,
        destination: request.destination,
        error: 'Flight search is temporarily unavailable. Please try again.',
      },
    };
  }
}

TicketBooking.getLayout = (page) => <Layout>{page}</Layout>;

export default TicketBooking;
