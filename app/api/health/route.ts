export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    {
      service: 'sf',
      status: 'ok',
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
