import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import {
  createHospitalityImage,
  removeHospitalityImage,
  setPrimaryHospitalityImage,
} from '@/server/inventory/hospitality-image-service.ts';

function preservePage(query: URLSearchParams, key: 'typePage' | 'imagePage', value: string) {
  if (!/^[1-9]\d*$/.test(value)) return;
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 1) query.set(key, String(parsed));
}

function target(propertyId: string, roomTypeId: string, typePage: string, imagePage: string, suffix: string) {
  const query = new URLSearchParams();
  if (roomTypeId) query.set('roomType', roomTypeId);
  preservePage(query, 'typePage', typePage);
  preservePage(query, 'imagePage', imagePage);
  if (suffix) {
    const [key, value] = suffix.split('=');
    if (key && value) query.set(key, value);
  }
  const encoded = query.toString();
  return `/inventory/${encodeURIComponent(propertyId)}/images${encoded ? `?${encoded}` : ''}`;
}

export async function POST(request: Request) {
  const mutation = await prepareInventoryMutationRequest(request, 'inventory.image.mutate');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;

  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath('/inventory?error=validation'), 'rejected');
  }

  let propertyId = '';
  let roomTypeId = '';
  let typePage = '';
  let imagePage = '';
  try {
    propertyId = formField(formData, 'propertyId');
    roomTypeId = formField(formData, 'roomTypeId');
    typePage = formField(formData, 'typePage');
    imagePage = formField(formData, 'imagePage');
    const action = formField(formData, 'action') || 'create';
    const scope = {
      organizationId: organization.id,
      actorUserId: session.user.id,
      propertyId,
      ...(roomTypeId ? { roomTypeId } : {}),
    };

    if (action === 'set-primary') {
      await setPrimaryHospitalityImage({ ...scope, imageId: formField(formData, 'imageId') });
      return finish(redirectToLocalPath(target(propertyId, roomTypeId, typePage, imagePage, 'status=image-primary')));
    }
    if (action === 'remove') {
      await removeHospitalityImage({ ...scope, imageId: formField(formData, 'imageId'), confirmation: formField(formData, 'confirmation') });
      return finish(redirectToLocalPath(target(propertyId, roomTypeId, typePage, imagePage, 'status=image-removed')));
    }
    if (action !== 'create') return finish(new Response('Bad Request', { status: 400 }));

    await createHospitalityImage({
      ...scope,
      image: {
        url: formField(formData, 'url'),
        altText: formField(formData, 'altText'),
        sortOrder: formField(formData, 'sortOrder'),
        isPrimary: formField(formData, 'isPrimary'),
      },
    });
    return finish(redirectToLocalPath(target(propertyId, roomTypeId, typePage, imagePage, 'status=image-created')));
  } catch (error) {
    const code = inventoryErrorCode(error);
    const response = !propertyId
      ? redirectToLocalPath(`/inventory?error=${code}`)
      : redirectToLocalPath(target(propertyId, roomTypeId, typePage, imagePage, `error=${code}`));
    return finish(response, code === 'server' ? 'failed' : 'rejected');
  }
}
