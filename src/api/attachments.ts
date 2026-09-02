import { pb } from './pocketbase';

// Bilder attached to a lokalitet: kept LiDAR extracts, map screenshots,
// and plain uploads. Visibility follows the parent lokalitet via the
// collection rules, and the file field is *protected* — image bytes are
// only served with a short-lived file token (see getAttachmentUrl).
export type AttachmentKind = 'extract' | 'screenshot' | 'upload';

// Free-form; extracts store sourceKey/sourceLabel/style/metresPerPx/
// bbox25833 so the gallery can say what an image shows.
export type AttachmentMeta = Record<string, unknown>;

export type AttachmentRecord = {
  id: string;
  locality: string;
  owner: string;
  kind: AttachmentKind;
  // Server-side filename within the record's storage dir.
  file: string;
  caption: string;
  meta: AttachmentMeta | null;
  created: string;
  updated: string;
  // Set by PB on fetched records; pb.files.getUrl needs one of them.
  collectionId?: string;
  collectionName?: string;
};

export type NewAttachmentInput = {
  locality: string;
  kind: AttachmentKind;
  caption?: string;
  meta?: AttachmentMeta;
};

const COLLECTION = 'attachments';

export const listLocalityAttachments = async (
  localityId: string,
): Promise<AttachmentRecord[]> => {
  return pb.collection(COLLECTION).getFullList<AttachmentRecord>({
    filter: pb.filter('locality = {:lid}', { lid: localityId }),
    sort: '-created',
  });
};

export const createAttachment = async (
  input: NewAttachmentInput,
  ownerId: string,
  blob: Blob,
  filename: string,
): Promise<AttachmentRecord> => {
  const form = new FormData();
  form.append('locality', input.locality);
  form.append('owner', ownerId);
  form.append('kind', input.kind);
  form.append('caption', input.caption ?? '');
  if (input.meta) form.append('meta', JSON.stringify(input.meta));
  form.append('file', blob, filename);
  return pb.collection(COLLECTION).create<AttachmentRecord>(form);
};

export const updateAttachmentCaption = async (
  id: string,
  caption: string,
): Promise<AttachmentRecord> => {
  return pb.collection(COLLECTION).update<AttachmentRecord>(id, { caption });
};

export const deleteAttachment = async (id: string): Promise<void> => {
  await pb.collection(COLLECTION).delete(id);
};

// PB file tokens are valid ~2 minutes; cache one and refresh early so a
// gallery of thumbnails costs a single token request, not one each.
let fileToken: { token: string; fetchedAt: number } | null = null;
const FILE_TOKEN_MAX_AGE_MS = 100000;

const getFileToken = async (): Promise<string> => {
  const now = Date.now();
  if (!fileToken || now - fileToken.fetchedAt > FILE_TOKEN_MAX_AGE_MS) {
    fileToken = { token: await pb.files.getToken(), fetchedAt: now };
  }
  return fileToken.token;
};

// Tokened URL for a protected attachment file. `thumb` takes the sizes
// declared in the migration ('200x200' grid thumb, '800x0' preview);
// omit it for the original.
export const getAttachmentUrl = async (
  rec: AttachmentRecord,
  thumb?: '200x200' | '800x0',
): Promise<string> => {
  const token = await getFileToken();
  return pb.files.getUrl(rec, rec.file, { token, thumb });
};

export const subscribeAttachments = (
  handler: (
    action: 'create' | 'update' | 'delete',
    rec: AttachmentRecord,
  ) => void,
): (() => void) => {
  const p = pb
    .collection(COLLECTION)
    .subscribe<AttachmentRecord>('*', (e) => {
      handler(e.action as 'create' | 'update' | 'delete', e.record);
    });
  return () => {
    p.then((unsub) => unsub()).catch(() => {
      /* ignore — connection may already be down */
    });
  };
};
