import {
  Box,
  Button,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Stack,
  Text,
} from '@kvib/react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentUserAtom, isAdminAtom } from './atoms';
import { isAuthDialogOpenAtom } from './atoms-dialog';
import { useSignOut } from './hooks';

const initials = (nameOrEmail: string): string => {
  const trimmed = nameOrEmail.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/[\s@._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? trimmed[0];
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
};

// Sits at the far right of TopBar. Signed out → "Logg inn" opens
// AuthDialog. Signed in → avatar chip; popover has an admin marker
// and sign-out. Using Popover to stay consistent with the LiDAR
// pulldown pattern in TopBar rather than pulling in Chakra's Menu
// primitives, whose surface in @kvib we can't verify offline.
export const AuthButton = () => {
  const { t } = useTranslation();
  const user = useAtomValue(currentUserAtom);
  const isAdmin = useAtomValue(isAdminAtom);
  const openDialog = useSetAtom(isAuthDialogOpenAtom);
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);

  if (!user) {
    return (
      <Button
        variant="secondary"
        colorPalette="green"
        size="sm"
        leftIcon="login"
        onClick={() => openDialog(true)}
      >
        {t('auth.signIn')}
      </Button>
    );
  }

  const label = user.name || user.email;

  return (
    <Popover
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
      positioning={{ placement: 'bottom-end', offset: { mainAxis: 8 } }}
    >
      <PopoverTrigger asChild>
        <Button variant="tertiary" size="sm" px={2}>
          <Box
            as="span"
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            w="28px"
            h="28px"
            borderRadius="full"
            bg={user.avatar ? 'transparent' : 'green.100'}
            color="green.900"
            fontSize="xs"
            fontWeight="bold"
            overflow="hidden"
          >
            {user.avatar ? (
              <Box
                as="img"
                src={user.avatar}
                alt={label}
                w="100%"
                h="100%"
                objectFit="cover"
              />
            ) : (
              initials(label)
            )}
          </Box>
        </Button>
      </PopoverTrigger>
      <PopoverContent width="220px" p={0} borderRadius="lg">
        <PopoverArrow />
        <PopoverBody p={2}>
          <Stack gap={1}>
            <Text fontSize="sm" fontWeight="semibold" px={1} lineClamp={1}>
              {label}
            </Text>
            {isAdmin && (
              <Text fontSize="xs" color="green.700" px={1}>
                {t('auth.roleAdmin')}
              </Text>
            )}
            <Box borderTop="1px solid" borderColor="gray.200" my={1} />
            <Button
              variant="ghost"
              size="sm"
              justifyContent="flex-start"
              leftIcon="logout"
              onClick={() => {
                signOut();
                setOpen(false);
              }}
            >
              {t('auth.signOut')}
            </Button>
          </Stack>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
};
