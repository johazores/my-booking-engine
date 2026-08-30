import type { NextApiHandler } from 'next';
import {
  FlightSearchValidationError,
  parseFlightSearchRequest,
  searchFlights,
} from '@/src/application/search-flights';
import { FlightProviderError } from '@/src/integrations/travel/rapid-api-flight-provider';

const providerStatus = (error: FlightProviderError): number => {
  switch (error.code) {
    case 'timeout':
      return 504;
    case 'configuration':
    case 'authentication':
    case 'rate-limit':
      return 503;
    default:
      return 502;
  }
};

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({
      error: {
        code: 'method_not_allowed',
        message: 'Only GET is supported for flight search.',
      },
    });
    return;
  }

  try {
    const request = parseFlightSearchRequest(req.query);
    const result = await searchFlights(request);

    res.status(200).json({ data: result });
  } catch (error) {
    if (error instanceof FlightSearchValidationError) {
      res.status(400).json({
        error: {
          code: 'invalid_request',
          message: error.message,
          details: error.issues,
        },
      });
      return;
    }

    if (error instanceof FlightProviderError) {
      console.error('flight-search provider failure', {
        providerId: error.providerId,
        code: error.code,
        status: error.status,
      });

      res.status(providerStatus(error)).json({
        error: {
          code: 'provider_unavailable',
          message: 'Flight search is temporarily unavailable. Please try again.',
        },
      });
      return;
    }

    console.error('flight-search unexpected failure');
    res.status(500).json({
      error: {
        code: 'internal_error',
        message: 'Flight search could not be completed.',
      },
    });
  }
};

export default handler;
