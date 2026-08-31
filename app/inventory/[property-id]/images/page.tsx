import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage } from '@/server/inventory/hospitality-domain.ts';
import { listHospitalityImages } from '@/server/inventory/hospitality-image-service.ts';
import { listHospitalityRoomTypes, readHospitalityProperty, readHospitalityRoomType } from '@/server/inventory/hospitality-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const messages: Record<string, string> = {
  'image-created': 'Image added.',
  'image-primary': 'Primary image updated.',
  'image-removed': 'Image removed.',
};

const errors: Record<string, string> = {
  permission: 'You do not have permission to manage inventory images.',
  conflict: 'That image URL is already used in this scope.',
  unavailable: 'That property, room type, or image is not available in this organization.',
  validation: 'Check the image URL, alt text, and display order.',
  server: 'The image operation could not be completed. Try again.',
};

function scopeHref(propertyId: string, roomTypeId?: string, page = 1) {
  const query = new URLSearchParams();
  if (roomTypeId) query.set('roomType', roomTypeId);
  if (page > 1) query.set('typePage', String(page));
  const encoded = query.toString();
  return `/inventory/${propertyId}/images${encoded ? `?${encoded}` : ''}`;
}

export default async function HospitalityImagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'property-id': string }>;
  searchParams: Promise<{ roomType?: string; typePage?: string; status?: string; error?: string }>;
}) {
  const authState = await readAuthSessionState();
  const authRedirect = getAuthRequiredRedirect(authState);
  if (authRedirect) redirect(authRedirect);
  const session = authState.session;
  if (!session) throw new Error('Authenticated inventory guard returned without a session');

  const routeParams = await params;
  const query = await searchParams;
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) redirect('/inventory?error=tenant');
  const organization = activeContext.organization;
  const authorization = await readOrganizationAuthorization({ organizationId: organization.id, userId: session.user.id });
  const canRead = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'inventory:read')));
  const canManage = Boolean(authorization?.platformAdmin || (authorization?.role && organizationRoleHasPermission(authorization.role, 'inventory:manage')));
  if (!canRead) return <section className="sf-inventory-empty"><p className="sf-eyebrow">Inventory</p><h1>Inventory access is restricted</h1><p>Your organization role does not include inventory access.</p></section>;

  const propertyId = routeParams['property-id'];
  const property = await readHospitalityProperty({ organizationId: organization.id, actorUserId: session.user.id, propertyId });
  if (!property) notFound();

  const typePage = parseInventoryPage(query.typePage);
  const roomTypes = await listHospitalityRoomTypes({ organizationId: organization.id, actorUserId: session.user.id, propertyId, page: typePage, pageSize: 20 });
  const requestedRoomType = query.roomType
    ? await readHospitalityRoomType({ organizationId: organization.id, actorUserId: session.user.id, roomTypeId: query.roomType })
    : null;
  const selectedRoomType = requestedRoomType?.propertyId === propertyId ? requestedRoomType : null;
  const images = await listHospitalityImages({
    organizationId: organization.id,
    actorUserId: session.user.id,
    propertyId,
    ...(selectedRoomType ? { roomTypeId: selectedRoomType.id } : {}),
  });
  const canMutateScope = canManage && property.status === 'ACTIVE' && (!selectedRoomType || selectedRoomType.status === 'ACTIVE');

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header">
      <div>
        <Link className="sf-back-link" href={`/inventory/${propertyId}`}>← {property.name}</Link>
        <p className="sf-eyebrow">Hospitality media</p>
        <h1>Images</h1>
        <p>Manage real HTTPS-hosted images for the property and its room types.</p>
      </div>
      <span className={`sf-status-badge${property.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{property.status.toLowerCase()}</span>
    </header>

    {query.status && messages[query.status] ? <p className="sf-alert sf-alert--success" role="status">{messages[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}

    <section className="sf-inventory-card sf-image-scope" aria-labelledby="image-scope-title">
      <div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Image scope</p><h2 id="image-scope-title">Choose what these images describe</h2></div><span>{images.length} images</span></div>
      <nav className="sf-image-scope__nav" aria-label="Image scope">
        <Link className={`sf-button sf-button--compact${!selectedRoomType ? ' sf-button--primary' : ' sf-button--secondary'}`} href={scopeHref(propertyId)}>Property</Link>
        {roomTypes.roomTypes.map((roomType) => <Link key={roomType.id} className={`sf-button sf-button--compact${selectedRoomType?.id === roomType.id ? ' sf-button--primary' : ' sf-button--secondary'}`} href={scopeHref(propertyId, roomType.id, roomTypes.page)}>{roomType.name}</Link>)}
      </nav>
      {roomTypes.totalPages > 1 ? <nav className="sf-pagination" aria-label="Room type image-scope pages">
        {roomTypes.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={scopeHref(propertyId, undefined, roomTypes.page - 1)}>Previous room types</Link> : <span />}
        <span>Room types page {roomTypes.page} of {roomTypes.totalPages}</span>
        {roomTypes.page < roomTypes.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={scopeHref(propertyId, undefined, roomTypes.page + 1)}>Next room types</Link> : <span />}
      </nav> : null}
    </section>

    <section className="sf-inventory-card" aria-labelledby="image-list-title">
      <div className="sf-inventory-card__heading">
        <div><p className="sf-eyebrow">{selectedRoomType ? 'Room type gallery' : 'Property gallery'}</p><h2 id="image-list-title">{selectedRoomType ? selectedRoomType.name : property.name} images</h2><p>Primary images sort first. Display order controls the remaining gallery sequence.</p></div>
      </div>
      {images.length === 0 ? <div className="sf-empty-state"><h3>No images yet</h3><p>{canMutateScope ? 'Add the first hosted image below.' : 'No images are configured for this scope.'}</p></div> : <ul className="sf-image-grid">
        {images.map((image) => <li className="sf-image-card" key={image.id}>
          {/* Arbitrary tenant-hosted HTTPS assets cannot use next/image without a deployment-wide remote-host allowlist. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sf-image-card__preview" src={image.url} alt={image.altText} loading="lazy" />
          <div className="sf-image-card__body"><div><strong>{image.altText}</strong><span>Order {image.sortOrder}{image.isPrimary ? ' · Primary' : ''}</span></div>
            {canMutateScope ? <div className="sf-image-card__actions">
              {!image.isPrimary ? <form action="/api/inventory/images" method="post"><input type="hidden" name="propertyId" value={propertyId} /><input type="hidden" name="roomTypeId" value={selectedRoomType?.id ?? ''} /><input type="hidden" name="imageId" value={image.id} /><input type="hidden" name="action" value="set-primary" /><button className="sf-button sf-button--secondary sf-button--compact" type="submit">Set primary</button></form> : null}
              <form action="/api/inventory/images" method="post"><input type="hidden" name="propertyId" value={propertyId} /><input type="hidden" name="roomTypeId" value={selectedRoomType?.id ?? ''} /><input type="hidden" name="imageId" value={image.id} /><input type="hidden" name="action" value="remove" /><button className="sf-button sf-button--danger sf-button--compact" type="submit">Remove</button></form>
            </div> : null}
          </div>
        </li>)}
      </ul>}
    </section>

    {canMutateScope ? <section className="sf-inventory-card sf-inventory-card--create" aria-labelledby="add-image-title">
      <p className="sf-eyebrow">Add media</p><h2 id="add-image-title">Add hosted image</h2>
      <p className="sf-muted-copy">Use a production HTTPS asset URL from your existing CDN or media host. File uploads will be added only with a real storage adapter.</p>
      <form className="sf-form" action="/api/inventory/images" method="post">
        <input type="hidden" name="propertyId" value={propertyId} /><input type="hidden" name="roomTypeId" value={selectedRoomType?.id ?? ''} /><input type="hidden" name="action" value="create" />
        <label className="sf-field">Image URL<input type="url" name="url" maxLength={2048} required placeholder="https://cdn.example.com/property.jpg" /></label>
        <label className="sf-field">Alt text<input name="altText" maxLength={200} required placeholder="Pool terrace overlooking the garden" /></label>
        <div className="sf-form-row"><label className="sf-field">Display order<input type="number" name="sortOrder" min={0} max={9999} defaultValue={0} required /></label><label className="sf-field sf-checkbox-field"><input type="checkbox" name="isPrimary" /> Make primary image</label></div>
        <button className="sf-button sf-button--primary" type="submit">Add image</button>
      </form>
    </section> : <p className="sf-muted-copy">This image scope is read-only because of your role or the inventory lifecycle state.</p>}
  </div>;
}
