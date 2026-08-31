import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getAuthRequiredRedirect, readAuthSessionState } from '@/server/auth/auth-http.ts';
import { organizationRoleHasPermission } from '@/server/authorization/authorization-domain.ts';
import { readOrganizationAuthorization } from '@/server/authorization/authorization-service.ts';
import { parseInventoryPage, parseInventoryPageSize } from '@/server/inventory/hospitality-domain.ts';
import { listHospitalityRooms, listHospitalityRoomTypes, readHospitalityProperty, readHospitalityRoomType } from '@/server/inventory/hospitality-service.ts';
import { readActiveOrganizationContext } from '@/server/tenancy/tenant-context.ts';

const errors: Record<string, string> = {
  permission: 'You do not have permission to manage inventory.',
  conflict: 'That inventory code is already in use.',
  dependency: 'Archive dependent rooms before archiving this record.',
  unavailable: 'That inventory record is not available in this organization.',
  validation: 'Check the inventory details and try again.',
  server: 'The inventory operation could not be completed. Try again.',
};
const statuses: Record<string, string> = {
  created: 'Property created.',
  'room-type-created': 'Room type created.',
  'room-created': 'Room created.',
  'room-type-archived': 'Room type archived.',
  'room-archived': 'Room archived.',
};

function propertyHref(propertyId: string, input: { roomType?: string; typePage?: number; roomPage?: number; pageSize: number }) {
  const params = new URLSearchParams();
  if (input.roomType) params.set('roomType', input.roomType);
  if ((input.typePage ?? 1) > 1) params.set('typePage', String(input.typePage));
  if ((input.roomPage ?? 1) > 1) params.set('roomPage', String(input.roomPage));
  if (input.pageSize !== 20) params.set('pageSize', String(input.pageSize));
  const query = params.toString();
  return query ? `/inventory/${propertyId}?${query}` : `/inventory/${propertyId}`;
}

export default async function PropertyInventoryPage({ params, searchParams }: {
  params: Promise<{ 'property-id': string }>;
  searchParams: Promise<{ roomType?: string; typePage?: string; roomPage?: string; pageSize?: string; status?: string; error?: string }>;
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
  const pageSize = parseInventoryPageSize(query.pageSize);
  const roomTypes = await listHospitalityRoomTypes({ organizationId: organization.id, actorUserId: session.user.id, propertyId, page: parseInventoryPage(query.typePage), pageSize });
  const requestedRoomType = query.roomType ? await readHospitalityRoomType({ organizationId: organization.id, actorUserId: session.user.id, roomTypeId: query.roomType }) : null;
  const selectedRoomType = requestedRoomType?.propertyId === propertyId ? requestedRoomType : roomTypes.roomTypes.find((item) => item.status === 'ACTIVE') ?? roomTypes.roomTypes[0] ?? null;
  const rooms = selectedRoomType ? await listHospitalityRooms({ organizationId: organization.id, actorUserId: session.user.id, propertyId, roomTypeId: selectedRoomType.id, page: parseInventoryPage(query.roomPage), pageSize }) : null;

  return <div className="sf-inventory-page">
    <header className="sf-inventory-page__header"><div><Link className="sf-back-link" href="/inventory">← Properties</Link><p className="sf-eyebrow">Hospitality property</p><h1>{property.name}</h1><p>{property.code} · {property.city ?? property.countryCode} · {property.timezone}</p></div><span className={`sf-status-badge${property.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{property.status.toLowerCase()}</span></header>
    {query.status && statuses[query.status] ? <p className="sf-alert sf-alert--success" role="status">{statuses[query.status]}</p> : null}
    {query.error && errors[query.error] ? <p className="sf-alert sf-alert--error" role="alert">{errors[query.error]}</p> : null}

    <section className="sf-inventory-summary" aria-label="Property details"><div><span>Country</span><strong>{property.countryCode}</strong></div><div><span>Address</span><strong>{[property.addressLine1, property.city, property.region, property.postalCode].filter(Boolean).join(', ') || 'Not set'}</strong></div><div><span>Room types</span><strong>{roomTypes.total}</strong></div></section>

    <div className={`sf-inventory-layout${canManage && property.status === 'ACTIVE' ? '' : ' sf-inventory-layout--single'}`}>
      <section className="sf-inventory-card" aria-labelledby="room-types-title"><div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Categories</p><h2 id="room-types-title">Room types</h2></div><span>{roomTypes.total} total</span></div>
        {roomTypes.roomTypes.length === 0 ? <div className="sf-empty-state"><h3>No room types yet</h3><p>Create a room type before adding physical rooms.</p></div> : <ul className="sf-inventory-list">{roomTypes.roomTypes.map((roomType) => <li key={roomType.id}><Link className={`sf-inventory-list__link${selectedRoomType?.id === roomType.id ? ' sf-inventory-list__link--selected' : ''}`} href={propertyHref(propertyId, { roomType: roomType.id, typePage: roomTypes.page, pageSize })}><div><strong>{roomType.name}</strong><span>{roomType.code} · up to {roomType.maxOccupancy} guests</span></div><div className="sf-inventory-list__meta"><span className={`sf-status-badge${roomType.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{roomType.status.toLowerCase()}</span><span>{roomType._count.rooms} rooms</span></div></Link></li>)}</ul>}
        {roomTypes.total > pageSize ? <nav className="sf-pagination" aria-label="Room type pages">{roomTypes.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={propertyHref(propertyId, { roomType: selectedRoomType?.id, typePage: roomTypes.page - 1, pageSize })}>Previous</Link> : <span />}<span>Page {roomTypes.page} of {roomTypes.totalPages}</span>{roomTypes.page < roomTypes.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={propertyHref(propertyId, { roomType: selectedRoomType?.id, typePage: roomTypes.page + 1, pageSize })}>Next</Link> : <span />}</nav> : null}
      </section>
      {canManage && property.status === 'ACTIVE' ? <aside className="sf-inventory-card sf-inventory-card--create"><p className="sf-eyebrow">New category</p><h2>Create room type</h2><form className="sf-form" action="/api/inventory/room-types" method="post"><input type="hidden" name="propertyId" value={propertyId} /><label className="sf-field">Name<input name="name" maxLength={120} required /></label><div className="sf-form-row"><label className="sf-field">Code<input name="code" maxLength={32} required /></label><label className="sf-field">Max occupancy<input type="number" name="maxOccupancy" min={1} max={50} required defaultValue={2} /></label></div><label className="sf-field">Bed description<input name="bedsDescription" maxLength={160} placeholder="1 king bed" /></label><button className="sf-button sf-button--primary" type="submit">Create room type</button></form></aside> : null}
    </div>

    {selectedRoomType ? <section className="sf-inventory-card sf-inventory-rooms" aria-labelledby="rooms-title"><div className="sf-inventory-card__heading"><div><p className="sf-eyebrow">Physical inventory</p><h2 id="rooms-title">{selectedRoomType.name} rooms</h2><p>{selectedRoomType.bedsDescription ?? 'No bed description'} · max {selectedRoomType.maxOccupancy} guests</p></div><span>{rooms?.total ?? 0} rooms</span></div>
      {rooms && rooms.rooms.length > 0 ? <div className="sf-room-table-wrap"><table className="sf-room-table"><thead><tr><th scope="col">Room</th><th scope="col">Floor</th><th scope="col">Status</th>{canManage && selectedRoomType.status === 'ACTIVE' && property.status === 'ACTIVE' ? <th scope="col">Action</th> : null}</tr></thead><tbody>{rooms.rooms.map((room) => <tr key={room.id}><th scope="row">{room.code}</th><td>{room.floor ?? '—'}</td><td><span className={`sf-status-badge${room.status === 'ARCHIVED' ? ' sf-status-badge--muted' : ''}`}>{room.status.toLowerCase().replaceAll('_', ' ')}</span></td>{canManage && selectedRoomType.status === 'ACTIVE' && property.status === 'ACTIVE' ? <td>{room.status !== 'ARCHIVED' ? <form action={`/api/inventory/rooms/${room.id}/archive`} method="post" className="sf-archive-inline"><input type="hidden" name="propertyId" value={propertyId} /><input type="hidden" name="roomTypeId" value={selectedRoomType.id} /><input className="sf-archive-inline__input" name="confirmation" aria-label={`Type ARCHIVE to archive room ${room.code}`} placeholder="ARCHIVE" required /><button className="sf-button sf-button--danger sf-button--compact" type="submit">Archive</button></form> : '—'}</td> : null}</tr>)}</tbody></table></div> : <div className="sf-empty-state"><h3>No rooms in this type</h3><p>Create physical room inventory when this category is ready.</p></div>}
      {rooms && rooms.total > pageSize ? <nav className="sf-pagination" aria-label="Room pages">{rooms.page > 1 ? <Link className="sf-button sf-button--secondary sf-button--compact" href={propertyHref(propertyId, { roomType: selectedRoomType.id, typePage: roomTypes.page, roomPage: rooms.page - 1, pageSize })}>Previous</Link> : <span />}<span>Page {rooms.page} of {rooms.totalPages}</span>{rooms.page < rooms.totalPages ? <Link className="sf-button sf-button--secondary sf-button--compact" href={propertyHref(propertyId, { roomType: selectedRoomType.id, typePage: roomTypes.page, roomPage: rooms.page + 1, pageSize })}>Next</Link> : <span />}</nav> : null}
      {canManage && selectedRoomType.status === 'ACTIVE' && property.status === 'ACTIVE' ? <div className="sf-inventory-create-room"><h3>Add room</h3><form className="sf-form sf-form--inline" action="/api/inventory/rooms" method="post"><input type="hidden" name="propertyId" value={propertyId} /><input type="hidden" name="roomTypeId" value={selectedRoomType.id} /><label className="sf-field">Room code<input name="code" maxLength={32} required /></label><label className="sf-field">Floor<input name="floor" maxLength={40} /></label><button className="sf-button sf-button--primary" type="submit">Add room</button></form></div> : null}
      {canManage && selectedRoomType.status === 'ACTIVE' && property.status === 'ACTIVE' ? <form className="sf-danger-zone" action={`/api/inventory/room-types/${selectedRoomType.id}/archive`} method="post"><input type="hidden" name="propertyId" value={propertyId} /><div><strong>Archive room type</strong><span>All rooms must be archived first.</span></div><label className="sf-field">Confirmation<input name="confirmation" placeholder="ARCHIVE" required /></label><button className="sf-button sf-button--danger" type="submit">Archive room type</button></form> : null}
    </section> : null}

    {canManage && property.status === 'ACTIVE' ? <section className="sf-danger-zone sf-danger-zone--property"><div><strong>Archive property</strong><span>All active room types must be archived first. Historical records remain preserved.</span></div><form className="sf-danger-zone__form" action={`/api/inventory/properties/${property.id}/archive`} method="post"><label className="sf-field">Type ARCHIVE<input name="confirmation" placeholder="ARCHIVE" required /></label><button className="sf-button sf-button--danger" type="submit">Archive property</button></form></section> : null}
  </div>;
}
