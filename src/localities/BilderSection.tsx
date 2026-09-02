import {
  Box,
  Button,
  Flex,
  Heading,
  IconButton,
  Spinner,
  Stack,
  Text,
} from '@kvib/react';
import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AttachmentRecord,
  createAttachment,
  deleteAttachment,
  getAttachmentUrl,
  listLocalityAttachments,
  subscribeAttachments,
} from '../api/attachments';
import { LocalityRecord } from '../api/localities';

const THUMB_PX = 96;

// One thumbnail. URLs are async because the file field is protected —
// every render needs a (cached) short-lived file token.
const AttachmentThumb = ({
  rec,
  canDelete,
  onDelete,
}: {
  rec: AttachmentRecord;
  canDelete: boolean;
  onDelete: (rec: AttachmentRecord) => void;
}) => {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAttachmentUrl(rec, '200x200')
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch((e) => console.warn('[BilderSection] thumb url failed', e));
    return () => {
      cancelled = true;
    };
  }, [rec.id, rec.file]);

  const openFull = () => {
    getAttachmentUrl(rec)
      .then((u) => window.open(u, '_blank', 'noopener'))
      .catch((e) => console.warn('[BilderSection] open failed', e));
  };

  return (
    <Box w={`${THUMB_PX}px`} position="relative">
      <Box
        as="button"
        onClick={openFull}
        w={`${THUMB_PX}px`}
        h={`${THUMB_PX}px`}
        borderRadius="md"
        overflow="hidden"
        borderWidth="1px"
        borderColor="gray.200"
        bg="gray.100"
        cursor="pointer"
        title={rec.caption || rec.kind}
      >
        {url && (
          <img
            src={url}
            alt={rec.caption || rec.kind}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        )}
      </Box>
      {canDelete && (
        <IconButton
          icon="close"
          size="xs"
          variant="solid"
          colorPalette="red"
          aria-label={t('localities.bilder.delete')}
          position="absolute"
          top="-6px"
          right="-6px"
          borderRadius="full"
          onClick={() => onDelete(rec)}
        />
      )}
      {rec.caption && (
        <Text fontSize="9px" color="gray.600" lineClamp={1} mt={0.5}>
          {rec.caption}
        </Text>
      )}
    </Box>
  );
};

export const BilderSection = ({
  locality,
  userId,
  isMine,
}: {
  locality: LocalityRecord;
  userId: string;
  isMine: boolean;
}) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<AttachmentRecord[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listLocalityAttachments(locality.id));
    } catch (e) {
      console.warn('[BilderSection] load failed', e);
      setItems([]);
    }
  }, [locality.id]);

  useEffect(() => {
    setItems(null);
    load();
    const unsub = subscribeAttachments((_action, rec) => {
      if (rec.locality === locality.id) load();
    });
    return unsub;
  }, [load, locality.id]);

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      await createAttachment(
        { locality: locality.id, kind: 'upload', caption: file.name },
        userId,
        file,
        file.name,
      );
      load();
    } catch (err) {
      console.warn('[BilderSection] upload failed', err);
      window.alert(t('localities.bilder.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (rec: AttachmentRecord) => {
    if (!window.confirm(t('localities.bilder.confirmDelete'))) return;
    try {
      await deleteAttachment(rec.id);
      setItems((prev) => (prev ? prev.filter((it) => it.id !== rec.id) : prev));
    } catch (e) {
      console.warn('[BilderSection] delete failed', e);
    }
  };

  return (
    <Stack gap={2}>
      <Flex justify="space-between" align="center">
        <Heading size="xs">{t('localities.bilder.heading')}</Heading>
        {isMine && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={onUpload}
            />
            <Button
              size="xs"
              variant="secondary"
              colorPalette="green"
              leftIcon="upload"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading
                ? t('localities.bilder.uploading')
                : t('localities.bilder.upload')}
            </Button>
          </>
        )}
      </Flex>
      {items == null && (
        <Flex align="center" gap={2}>
          <Spinner size="xs" />
          <Text fontSize="xs" color="gray.500">
            {t('localities.bilder.loading')}
          </Text>
        </Flex>
      )}
      {items && items.length === 0 && (
        <Text fontSize="sm" color="gray.600">
          {t('localities.bilder.empty')}
        </Text>
      )}
      {items && items.length > 0 && (
        <Flex wrap="wrap" gap={2}>
          {items.map((rec) => (
            <AttachmentThumb
              key={rec.id}
              rec={rec}
              canDelete={isMine}
              onDelete={remove}
            />
          ))}
        </Flex>
      )}
    </Stack>
  );
};
