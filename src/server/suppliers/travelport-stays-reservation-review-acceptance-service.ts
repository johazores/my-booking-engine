import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { loadTravelportStaysIntegration } from '../integrations/travelport-stays-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveHospitalitySupplierReservationPaymentAuthority } from './hospitality-supplier-reservation-payment-authority.ts';
import { createHospitalitySupplierReservationReviewAcceptance } from './hospitality-supplier-reservation-review-acceptance.ts';
import { assertHospitalitySupplierReservationReviewAttemptAuthority } from './hospitality-supplier-reservation-review-attempt-authority.ts';
import { hospitalitySupplierReservationAuthorityInputFromOperation } from './hospitality-supplier-reservation-submission-authority.ts';
import {
  assertHospitalitySupplierReservationTravelerPayloadAuthority,
  type HospitalitySupplierReservationTravelerPayloadInput,
} from './hospitality-supplier-reservation-traveler-authority.ts';
import {
  HospitalitySupplierReservationConflictError,
} from './hospitality-supplier-reservation-domain.ts';
import { HospitalitySupplierReservationUnavailableError } from './hospitality-supplier-reservation-service.ts';

async function requireReviewAcceptanceAuthority(input: Readonly<{
  organizationId: string;
  actorUserId: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'availability:read',
  });
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'pricing:read',
  });
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'booking:manage',
  });
}

function reviewConflict(message: string) {
  return new HospitalitySupplierReservationConflictError(message);
}

function assertReviewOperation(reservation: Readonly<{
  status: string;
  providerCode: string;
  rooms: number;
  requestFingerprintVersion: number | null;
  lastFailureCode: string | null;
  reviewAcceptedAt: Date | null;
}>) {
  if (reservation.status !== 'REVIEW_REQUIRED') {
    throw reviewConflict('Supplier reservation is not waiting for an explicit commercial review decision.');
  }
  if (reservation.providerCode !== 'travelport-stays' || reservation.rooms !== 1 || reservation.requestFingerprintVersion !== 2) {
    throw reviewConflict('Supplier reservation review requires a current single-room Travelport reservation request.');
  }
  if (reservation.reviewAcceptedAt) {
    throw reviewConflict('Supplier reservation review was already accepted and cannot be overwritten.');
  }
}

function assertIntegrationMatches(
  integration: Readonly<{ id: string; providerCode: string; credentialVersion: number; capabilities: readonly string[]; status?: string }>,
  reservation: Readonly<{ integrationId: string; providerCode: string; integrationCredentialVersion: number }>,
) {
  if (
    integration.id !== reservation.integrationId
    || integration.providerCode !== reservation.providerCode
    || integration.credentialVersion !== reservation.integrationCredentialVersion
    || (integration.status !== undefined && integration.status !== 'ACTIVE')
    || !integration.capabilities.includes('reservation')
  ) {
    throw reviewConflict(
      'Supplier integration changed after the reservation review became pending. Review the supplier offer again.',
    );
  }
}

function assertCurrentCommercialAuthority(input: Readonly<{
  reservation: Readonly<{
    supplierPropertyReference: string;
    supplierOfferReference: string;
    currency: string;
    expectedTotalMinor: bigint;
    offerFingerprint: string;
    termsFingerprint: string;
  }>;
  requirements: Readonly<{ acceptPriceChange: boolean; acceptGuaranteeChange: boolean }>;
  offer: Readonly<{
    supplierPropertyReference: string;
    supplierOfferReference: string;
    offerFingerprint: string;
    price: Readonly<{ currency: string; totalMinor: bigint }>;
  }>;
}>) {
  if (
    input.offer.supplierPropertyReference !== input.reservation.supplierPropertyReference
    || input.offer.supplierOfferReference !== input.reservation.supplierOfferReference
    || input.offer.price.currency !== input.reservation.currency
  ) {
    throw reviewConflict('Fresh supplier offer no longer matches the reservation review scope.');
  }
  const priceChanged = input.offer.price.totalMinor !== input.reservation.expectedTotalMinor;
  if (priceChanged !== input.requirements.acceptPriceChange) {
    throw reviewConflict(
      'Fresh supplier price no longer matches the commercial change that was presented for acceptance.',
    );
  }
}

export async function acceptTravelportStaysReservationCommercialReview(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  traveler: HospitalitySupplierReservationTravelerPayloadInput;
  acceptPriceChange: unknown;
  acceptGuaranteeChange: unknown;
}>) {
  await requireReviewAcceptanceAuthority(input);
  assertUuidIdentifier(input.reservationId, 'reservationId');

  const reservation = await db.hospitalitySupplierReservationOperation.finYš\œİ
ÂˆÚ\™NˆÈYˆ[œ]œ™\Ù\˜][Û’YÜ™Ø[š^˜][Û’Yˆ[œ]›Ü™Ø[š^˜][Û’YKˆJNÂˆYˆ
\™\Ù\˜][ÛŠHÂˆ›İÈ™]ÈÜÜ][]Tİ\Y\”™\Ù\˜][Û•[˜]˜Z[X›Q\œ›ÜŠˆ	Ôİ\Y\ˆ™\Ù\˜][ÛˆÜ\˜][Ûˆ\È›İ]˜Z[X›H[ˆ\ÈÜ™Ø[š^˜][Û‹‰Ëˆ
NÂˆBˆ\ÜÙ\™]šY]ÓÜ\˜][ÛŠ™\Ù\˜][ÛŠNÂˆÛÛœİ™]šY]Ğ][\H]ØZ]‹šÜÜ][]Tİ\Y\”™\Ù\˜][Û][\™š[™š\œİ
ÂˆÚ\™NˆÂˆÜ™Ø[š^˜][Û’Yˆ[œ]›Ü™Ø[š^˜][Û’Yˆ™\Ù\˜][Û’Yˆ™\Ù\˜][Û‹šYˆÙ\]Y[˜ÙNˆ™\Ù\˜][Û‹˜][\Ûİ[ˆKˆJNÂˆÛÛœİ™\]Z\™[Y[ÈH\ÜÙ\ÜÜ][]Tİ\Y\”™\Ù\˜][Û”™]šY]Ğ][\]]Üš]JÈ™\Ù\˜][Û‹][\ˆ™]šY]Ğ][\JNÂˆYˆ
ˆ[œ]˜XØÙ\šXÙPÚ[™ÙHOOH™\]Z\™[Y[Ë˜XØÙ\šXÙPÚ[™ÙBˆ[œ]˜XØÙ\İX\˜[YPÚ[™ÙHOOH™\]Z\™[Y[Ë˜XØÙ\İX\˜[YPÚ[™ÙBˆ
HÂˆ›İÈ™]šY]ĞÛÛ™›Xİ
	Ôİ\Y\ˆ™\Ù\˜][Ûˆ™]šY]ÈXØÙ\[˜ÙH]\İ^XÚ]HX]ÚH[™[™ÈÛÛ[Y\˜ÚX[Ú[™ÙK‰ÊNÂˆB‚ˆ]˜]™[\]]Üš]NÂˆHÂˆ˜]™[\]]Üš]HH\ÜÙ\ÜÜ][]Tİ\Y\”™\Ù\˜][Û•˜]™[\”^[ØY]]Üš]JÂˆ^XİYš[™Ù\œš[ˆ™\Ù\˜][Û‹œ™\Ù\˜][Û”^[ØYš[™Ù\œš[ˆ˜]™[\ˆ[œ]˜]™[\‹ˆJNÂˆHØ]ÚÂˆ›İÈ™]šY]ĞÛÛ™›Xİ
ˆ	Ôš[X\H˜]™[\ˆ]Z[ÈÚ[™ÙYY\ˆHİ\Y\ˆ™\Ù\˜][Ûˆ™\]Y\İØ\È™\\™Yˆİ\H™]ÛH™]šY]ÙY™\Ù\˜][Ûˆ™\]Y\İ‰Ëˆ
NÂˆB‚ˆÛÛœİİ\œ™[H]ØZ]ØY˜]™[Üİ^\Ò[YÜ˜][ÛŠ[œ]›Ü™Ø[š^˜][Û’Y
NÂˆ\ÜÙ\[YÜ˜][Û“X]Ú\Êİ\œ™[š[YÜ˜][Û‹™\Ù\˜][ÛŠNÂ‚ˆÛÛœİš[Ü]]Üš]R[œ]HÜÜ][]Tİ\Y\”™\Ù\˜][Û]]Üš]R[œ]œ›ÛSÜ\˜][ÛŠ™\Ù\˜][ÛŠNÂˆÛÛœİÙ™™\”™]šY]ÈH]ØZ]İ\œ™[œ›İšY\‹œ™]˜[Y]T›Ü\SÙ™™\Šš[Ü]]Üš]R[œ]
NÂˆYˆ
[Ù™™\”™]šY]Ë›Ù™™\ˆÙ™™\”™]šY]Ëœİ]\ÈOOH	ÕSURSP“IÊHÂˆ›İÈ™]šY]ĞÛÛ™›Xİ
	Ôİ\Y\ˆÙ™™\ˆ\È›ÈÛ™Ù\ˆ]˜Z[X›H›ÜˆH[™[™ÈÛÛ[Y\˜ÚX[™]šY]Ë‰ÊNÂˆBˆ\ÜÙ\İ\œ™[ÛÛ[Y\˜ÚX[]]Üš]JÈ™\Ù\˜][Û‹™\]Z\™[Y[ËÙ™™\ˆÙ™™\”™]šY]Ë›Ù™™\ˆJNÂ‚ˆÛÛœİ™Yœ™\ÚYÙ™™\’[œ]HØš™Xİ™œ™Y^™JÂˆİ\Y\”›Ü\T™Y™\™[˜ÙNˆ™\Ù\˜][Û‹œİ\Y\”›Ü\T™Y™\™[˜ÙKˆİ\Y\“Ù™™\”™Y™\™[˜ÙNˆ™\Ù\˜][Û‹œİ\Y\“Ù™™\”™Y™\™[˜ÙKˆ^XİYÙ™™\‘š[™Ù\œš[ˆÙ™™\”™]šY]Ë›Ù™™\‹›Ù™™\‘š[™Ù\œš[ˆ^XİYİ[Z[›ÜˆÙ™™\”™]šY]Ë›Ù™™\‹œšXÙKİ[Z[›Ü‹ˆİ\œ™[˜ŞNˆ™\Ù\˜][Û‹˜İ\œ™[˜ŞKˆÚXÚÒ[‘]SØØ[ˆš[Ü]]Üš]R[œ]˜ÚXÚÒ[‘]SØØ[ˆÚXÚÓİ]]SØØ[ˆš[Ü]]Üš]R[œ]˜ÚXÚÓİ]]SØØ[ˆ›ÛÛ\Îˆ™\Ù\˜][Û‹œ›ÛÛ\ËˆY[Îˆ™\Ù\˜][Û‹˜Y[ËˆÚ[YÙ\ÎˆØš™Xİ™œ™Y^™JË‹‹œ™\Ù\˜][Û‹˜Ú[YÙ\×JKˆJNÂ‚ˆÛÛœİ\›\Ô™]šY]ÈH]ØZ]İ\œ™[˜›ÛÚÚ[™Õ\›\Ô›İšY\‹œ™]šY]™P›ÛÚÚ[™Õ\›\Ê™Yœ™\ÚYÙ™™\’[œ]
NÂˆYˆ
ˆ\›\Ô™]šY]Ëœİ]\ÈOOH	Ô‘PQIÂˆ]\›\Ô™]šY]Ë›Ù™™\‚ˆ]\›\Ô™]šY]Ë˜›ÛÚÚ[™Õ\›\Âˆ\›\Ô™]šY]Ë˜›ÛÚÚ[™Õ\›\Ë˜ÛÛ\]Q›Ü”™\Ù\˜][Û”™]šY]ÈOOHYBˆ\›\Ô™]šY]Ë˜›ÛÚÚ[™Õ\›\Ë˜İ\İÛY\“ŞX[T™\]Z\™Y]™\Ù\˜][ÛˆOOH˜[ÙBˆ\›\Ô™]šY]Ë›Ù™™\‹œİ\Y\”›Ü\T™Y™\™[˜ÙHOOH™\Ù\˜][Û‹œİ\Y\”›Ü\T™Y™\™[˜ÙBˆ\›\Ô™]šY]Ë›Ù™™\‹œİ\Y\“Ù™™\”™Y™\™[˜ÙHOOH™\Ù\˜][Û‹œİ\Y\“Ù™™\”™Y™\™[˜ÙBˆ\›\Ô™]šY]Ë›Ù™™\‹›Ù™™\‘š[™Ù\œš[OOHÙ™™\”™]šY]Ë›Ù™™\‹›Ù™™\‘š[™Ù\œš[ˆ\›\Ô™]šY]Ë›Ù™™\‹œšXÙK˜İ\œ™[˜ŞHOOH™\Ù\˜][Û‹˜İ\œ™[˜ŞBˆ\›\Ô™]šY]Ë›Ù™™\‹œšXÙKİ[Z[›ÜˆOOHÙ™™\”™]šY]Ë›Ù™™\‹œšXÙKİ[Z[›Ü‚ˆ
HÂˆ›İÈ™]šY]ĞÛÛ™›Xİ
	Ñœ™\Úİ\Y\ˆ[\È]]Üš]H\È›İİX›H[›İYÚÈXØÙ\H[™[™ÈÛÛ[Y\˜ÚX[Ú[™ÙK‰ÊNÂˆB‚ˆÛÛœİš[˜[]]Üš]HH]ØZ]İ\œ™[œ™\Ù\˜][Û]]Üš]T›İšY\‹™\šYT™\Ù\˜][Û]]Üš]JÂˆ‹‹œ™Yœ™\ÚYÙ™™\’[œ]ˆ^XİY\›\Ñš[™Ù\œš[ˆ\›\Ô™]šY]Ë˜›ÛÚÚ[™Õ\›\Ë\›\Ñš[™Ù\œš[ˆJNÂˆYˆ
ˆš[˜[]]Üš]Kœİ]\ÈOOH	Ô‘PQIÂˆYš[˜[]]Üš]K›Ù™™\‚ˆYš[˜[]]Üš]K˜›ÛÚÚ[™Õ\›\Âˆš[˜[]]Üš]K˜›ÛÚÚ[™Õ\›\Ë˜ÛÛ\]Q›Ü”™\Ù\˜][Û”™]šY]ÈOOHYBˆš[˜[]]Üš]K˜›ÛÚÚ[™Õ\›\Ë˜İ\İÛY\“ŞX[T™\]Z\™Y]™\Ù\˜][ÛˆOOH˜[ÙBˆš[˜[]]Üš]K›Ù™™\‹›Ù™™\‘š[™Ù\œš[OOH\›\Ô™]šY]Ë›Ù™™\‹›Ù™™\‘š[™Ù\œš[ˆš[˜[]]Üš]K›Ù™™\‹œšXÙK˜İ\œ™[˜ŞHOOH™\Ù\˜][Û‹˜İ\œ™[˜ŞBˆš[˜[]]Üš]K›Ù™™\‹œšXÙKİ[Z[›ÜˆOOH\›\Ô™]šY]Ë›Ù™™\‹œšXÙKİ[Z[›Ü‚ˆš[˜[]]Üš]K˜›ÛÚÚ[™Õ\›\Ë\›\Ñš[™Ù\œš[OOH\›\Ô™]šY]Ë˜›ÛÚÚ[™Õ\›\Ë\›\Ñš[™Ù\œš[ˆ\[Ùˆš[˜[]]Üš]K˜]]Üš]Qš[™Ù\œš[OOH	Üİš[™ÉÂˆK×–ÌNXKY—^ÍIË\İ
š[˜[]]Üš]K˜]]Üš]Qš[™Ù\œš[
Bˆ\[Ùˆš[˜[]]Üš]Kœ›İšY\”İX›Z\ÜÚ[Û”™Y™\™[˜ÙHOOH	Üİš[™ÉÂˆYš[˜[]]Üš]Kœ›İšY\”İX›Z\ÜÚ[Û”™Y™\™[˜ÙBˆ
HÂˆ›İÈ™]šY]ĞÛÛ™›Xİ
	Ñœ™\Úİ\Y\ˆ]˜Z[Xš[]H]]Üš]HÚ[™ÙY™Y›Ü™HHÛÛ[Y\˜ÚX[™]šY]ÈÛİ[™HXØÙ\Y‰ÊNÂˆB‚ˆÛÛœİ^[Y[]]Üš]HH\š]™RÜÜ][]Tİ\Y\”™\Ù\˜][Û”^[Y[]]Üš]JÂˆ›ÛÚÚ[™Õ\›\Îˆš[˜[]]Üš]K˜›ÛÚÚ[™Õ\›\Ëˆİ\œ™[˜ŞNˆ™\Ù\˜][Û‹˜İ\œ™[˜ŞKˆ^XİYİ[Z[›Üˆš[˜[]]Üš]K›Ù™™\‹œšXÙKİ[Z[›Ü‹ˆJNÂˆYˆ
\^[Y[]]Üš]JHÂˆ›İÈ™]šY]ĞÛÛ™›Xİ
	Ñœ™\Úİ\Y\ˆ^[Y[ÜˆİX\˜[YH]]Üš]H\È›İİ\ÜY›Üˆ™\Ù\˜][ÛˆXØÙ\[˜ÙK‰ÊNÂˆB‚ˆÛÛœİXØÙ\YHÜ™X]RÜÜ][]Tİ\Y\”™\Ù\˜][Û”™]šY]ĞXØÙ\[˜ÙJÂˆ™\Ù\˜][Û’Yˆ™\Ù\˜][Û‹šYˆXİÜ•\Ù\’Yˆ[œ]˜XİÜ•\Ù\’Yˆ™\Ù\˜][Û”^[ØYš[™Ù\œš[ˆ™\Ù\˜][Û‹œ™\Ù\˜][Û”^[ØYš[™Ù\œš[ˆ][\Ù\]Y[˜ÙNˆ™\Ù\˜][Û‹˜][\Ûİ[ˆ˜Z[\™PÛÙNˆ™\Ù\˜][Û‹›\İ˜Z[\™PÛÙKˆXØÙ\šXÙPÚ[™ÙNˆ[œ]˜XØÙ\šXÙPÚ[™ÙKˆXØÙ\İX\˜[YPÚ[™ÙNˆ[œ]˜XØÙ\İX\˜[YPÚ[™ÙKˆİ\œ™[˜ŞNˆ™\Ù\˜][Û‹˜İ\œ™[˜ŞKˆXØÙ\Yİ[Z[›Üˆš[˜[]]Üš]K›Ù™™\‹œšXÙKİ[Z[›Ü‹ˆXØÙ\YÙ™™\‘š[™Ù\œš[ˆš[˜[]]Üš]K›Ù™™\‹›Ù™™\‘š[™Ù\œš[ˆXØÙ\Y\›\Ñš[™Ù\œš[ˆš[˜[]]Üš]K˜›ÛÚÚ[™Õ\›\Ë\›\Ñš[™Ù\œš[ˆXØÙ\Y]]Üš]Qš[™Ù\œš[ˆš[˜[]]Üš]K˜]]Üš]Qš[™Ù\œš[ˆJNÂ‚ˆ™]\›ˆ‹‰˜[œØXİ[ÛŠ\Ş[˜È
˜[œØXİ[ÛŠHOˆÂˆ]ØZ]˜[œØXİ[Û‹‰]Y\T˜]ØÑSPÕ×ØYš\ÛÜWŞXİÛØÚÊ\Ú^^[™Y
	Øİ\Y\‹\™\Ù\˜][Û‰Ú[œ]›Ü™Ø[š^˜][Û’YN›Ü\˜][Û‰Ú[œ]œ™\Ù\˜][Û’YXK
JXÂ‚ˆÛÛœİ]\İH]ØZ]˜[œØXİ[Û‹šÜÜ][]Tİ\Y\”™\Ù\˜][Û“Ü\˜][Û‹™š[™š\œİ
ÂˆÚ\™NˆÈYˆ[œ]œ™\Ù\˜][Û’YÜ™Ø[š^˜][Û’Yˆ[œ]›Ü™Ø[š^˜][Û’YKˆJNÂˆYˆ
ˆ[]\İˆ]\İœİ]\ÈOOH	Ô‘U’QU×Ô‘TURT‘Q	Âˆ]\İ›\İ˜Z[\™PÛÙHOOH™\Ù\˜][Û‹›\İ˜Z[\™PÛÙBˆ]\İ˜][\Ûİ[OOH™\Ù\˜][Û‹˜][\Ûİ[ˆ]\İœ™\]Y\İš[™Ù\œš[OOH™\Ù\˜][Û‹œ™\]Y\İš[™Ù\œš[ˆ]\İœ™]šY]ĞXØÙ\Y]ˆ
HÂˆ›İÈ™]šY]ĞÛÛ™›Xİ
	Ôİ\Y\ˆ™\Ù\˜][Ûˆ™]šY]ÈÚ[™ÙYÚ[Hœ™\ÚÛÛ[Y\˜ÚX[]]Üš]HØ\È™Z[™È™\šYšYY‰ÊNÂˆB‚ˆÛÛœİ]\İ™]šY]Ğ][\H]ØZ]˜[œØXİ[Û‹šÜÜ][]Tİ\Y\”™\Ù\˜][Û][\™š[™š\œİ
ÂˆÚ\™NˆÂˆÜ™Ø[š^˜][Û’Yˆ[œ]›Ü™Ø[š^˜][Û’Yˆ™\Ù\˜][Û’Yˆ]\İšYˆÙ\]Y[˜ÙNˆ]\İ˜][\Ûİ[ˆKˆJNÂˆ\ÜÙ\ÜÜ][]Tİ\Y\”™\Ù\˜][Û”™]šY]Ğ][\]]Üš]JÈ™\Ù\˜][Ûˆ]\İ][\ˆ]\İ™]šY]Ğ][\JNÂˆYˆ
\™]šY]Ğ][\[]\İ™]šY]Ğ][\]\İ™]šY]Ğ][\šYOOH™]šY]Ğ][\šY
HÂˆ›İÈ™]šY]ĞÛÛ™›Xİ
	Ôİ\Y\ˆ™\Ù\˜][Ûˆ™]šY]È][\Ú[™ÙYÚ[Hœ™\ÚÛÛ[Y\˜ÚX[]]Üš]HØ\È™Z[™È™\šYšYY‰ÊNÂˆB‚ˆÛÛœİ[YÜ˜][ÛˆH]ØZ]˜[œØXİ[Û‹š[YÜ˜][Û‹™š[™š\œİ
ÂˆÚ\™NˆÈYˆ]\İš[YÜ˜][Û’YÜ™Ø[š^˜][Û’Yˆ[œ]›Ü™Ø[š^˜][Û’YKˆÙ[XİˆÈYˆYK›İšY\ÛÙNˆYKÜ™Y[X[™\œÚ[ÛˆYKØ\Xš[]Y\ÎˆYKİ]\ÎˆYHKˆJNÂˆYˆ
Z[YÜ˜][ÛŠH›İÈ™]šY]ĞÛÛ™›Xİ
	Ôİ\Y\ˆ[YÜ˜][Ûˆ\È›ÈÛ™Ù\ˆ]˜Z[X›H›Üˆ™\Ù\˜][ÛˆXØÙ\[˜ÙK‰ÊNÂˆ\ÜÙ\[YÜ˜][Û“X]Ú\Ê[YÜ˜][Û‹]\İ
NÂ‚ˆÛÛœİÙ]X˜\ÙPÛØÚ×HH]ØZ]˜[œØXİ[Û‹‰]Y\T˜]Ï\œ˜^OÈİ\œ™[[YNˆ]HO˜ÑSPÕÛØÚ×İ[Y\İ[\

HTÈ˜İ\œ™[[YH˜ÂˆYˆ
Y]X˜\ÙPÛØÚÊH›İÈ™]šY]ĞÛÛ™›Xİ
	Ôİ\Y\ˆ™\Ù\˜][ÛˆXØÙ\[˜ÙH[YH\È[˜]˜Z[X›K‰ÊNÂˆÛÛœİXØÙ\Y]H]X˜\ÙPÛØÚË˜İ\œ™[[YNÂˆÛÛœİ\]YH]ØZ]˜[œØXİ[Û‹šÜÜ][]Tİ\Y\”™\Ù\˜][Û“Ü\˜][Û‹\]JÂˆÚ\™NˆÈYˆ]\İšYÜ™Ø[š^˜][Û’Yˆ[œ]›Ü™Ø[š^˜][Û’YKˆ]NˆÂˆ™]šY]ĞXØÙ\Y]ˆXØÙ\Y]ˆ™]šY]ĞXØÙ\YU\Ù\’Yˆ[œ]˜XİÜ•\Ù\’Yˆ™]šY]ĞXØÙ\Y][\Ù\]Y[˜ÙNˆ]\İ˜][\Ûİ[ˆ™]šY]ĞXØÙ\YšXÙPÚ[™ÙNˆXØÙ\Y˜XØÙ\šXÙPÚ[™ÙKˆ™]šY]ĞXØÙ\YİX\˜[YPÚ[™ÙNˆXØÙ\Y˜XØÙ\İX\˜[YPÚ[™ÙKˆ™]šY]ĞXØÙ\Yİ\œ™[˜ŞNˆXØÙ\Y˜İ\œ™[˜ŞKˆ™]šY]ĞXØÙ\Yİ[Z[›ÜˆXØÙ\Y˜XØÙ\Yİ[Z[›Ü‹ˆ™]šY]ĞXØÙ\YÙ™™\‘š[™Ù\œš[ˆXØÙ\Y˜XØÙ\YÙ™™\‘š[™Ù\œš[ˆ™]šY]ĞXØÙ\Y\›\Ñš[™Ù\œš[ˆXØÙ\Y˜XØÙ\Y\›\Ñš[™Ù\œš[ˆ™]šY]ĞXØÙ\Y]]Üš]Qš[™Ù\œš[ˆXØÙ\Y˜XØÙ\Y]]Üš]Qš[™Ù\œš[ˆ™]šY]ĞXØÙ\[˜ÙQš[™Ù\œš[ˆXØÙ\Y˜XØÙ\[˜ÙQš[™Ù\œš[ˆKˆJNÂ‚ˆ]ØZ]˜[œØXİ[Û‹˜]Y]]™[˜Ü™X]JÂˆ]NˆÂˆÜ™Ø[š^˜][Û’Yˆ[œ]›Ü™Ø[š^˜][Û’YˆXİÜ•\Ù\’Yˆ[œ]˜XİÜ•\Ù\’YˆXİ[Ûˆ	Üİ\Y\‹œ™\Ù\˜][Û‹\™]šY]ËXXØÙ\Y	Ëˆ™\Ûİ\˜ÙU\Nˆ	Üİ\Y\‹\™\Ù\˜][Û‹[Ü\˜][Û‰Ëˆ™\Ûİ\˜ÙRYˆ]\İšYˆY\‘]NˆÂˆ›İšY\ÛÙNˆ]\İœ›İšY\ÛÙKˆ™]šY]Ô™X\ÛÛˆXØÙ\Yœ™X\ÛÛ‹ˆXØÙ\YšXÙPÚ[™ÙNˆXØÙ\Y˜XØÙ\šXÙPÚ[™ÙKˆXØÙ\YİX\˜[YPÚ[™ÙNˆXØÙ\Y˜XØÙ\İX\˜[YPÚ[™ÙKˆXØÙ\Yİ\œ™[˜ŞNˆXØÙ\Y˜İ\œ™[˜ŞKˆXØÙ\Yİ[Z[›ÜˆXØÙ\Y˜XØÙ\Yİ[Z[›Ü‹Ôİš[™Ê
Kˆ™]šY]Ğ][\Ù\]Y[˜ÙNˆ]\İ˜][\Ûİ[ˆXØÙ\[˜ÙQš[™Ù\œš[ˆXØÙ\Y˜XØÙ\[˜ÙQš[™Ù\œš[ˆKˆKˆJNÂ‚ˆ™]\›ˆØš™Xİ™œ™Y^™JÂˆ™\Ù\˜][Ûˆ\]YˆXØÙ\[˜ÙNˆXØÙ\Yˆ˜]™[\]]Üš]Kˆ^[Y[]]Üš]KˆJNÂˆKÈ\ÛÛ][Û“]™[ˆ	ÔÙ\šX[^˜X›IÈJNÂŸB