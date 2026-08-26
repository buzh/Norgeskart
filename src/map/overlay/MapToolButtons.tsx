import {
  Box,
  Button,
  HStack,
  Icon,
  MaterialSymbol,
  Text,
  toaster,
  VStack,
} from '@kvib/react';
import { useAtom, useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useIsMobileScreen } from '../../shared/hooks';
import { activeThemeLayersAtom } from '../layers/atoms';
import { mapToolAtom } from './atoms';

export const MapToolButtons = () => {
  const { t } = useTranslation();
  const [currentMapTool, setCurrentMapTool] = useAtom(mapToolAtom);
  const isMobile = useIsMobileScreen();
  const [menuVisible, setMenuVisible] = useState(true);
  const navigate = useNavigate();

  const handleShareMapClick = () => {
    const url = window.location.href;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        toaster.create({
          title: t('search.actions.shareMap.success'),
          duration: 2000,
        });
      })
      .catch(() => {
        // Clipboard access may be denied (e.g. in non-secure contexts)
      });
  };
  const activeLayers = useAtomValue(activeThemeLayersAtom);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditable =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      if (!isEditable && e.key.toLowerCase() === 'u') {
        if (menuVisible) {
          toaster.create({
            title: t('controller.menuHiddenToast'),
            duration: 3000,
          });
          setMenuVisible(false);
        } else {
          setMenuVisible(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [menuVisible, t]);

  if (!menuVisible) return null;

  return (
    <HStack
      align="flex-end"
      justify="space-between"
      bg="#FFFF"
      borderRadius={{ base: '', md: 'lg' }}
      shadow="lg"
      py={{ base: 1, md: 1 }}
      px={{ base: 0, md: 1 }}
      mb={{ base: 0, md: 0 }}
      pointerEvents={'all'}
      overflowX={{ base: 'auto', md: 'none' }}
    >
      <Box position="relative">
        <MapButton
          onClick={() => {
            setCurrentMapTool(currentMapTool === 'layers' ? null : 'layers');
          }}
          icon={'layers'}
          label={
            isMobile
              ? t('controller.maplayers.mobiletext')
              : t('controller.maplayers.openText')
          }
          active={currentMapTool === 'layers'}
          id="map-layers-button"
        />
        {activeLayers.size > 0 && (
          <Text
            position={'absolute'}
            top={-1}
            right={1}
            backgroundColor={'#FFDD9D'}
            borderRadius="full"
            borderWidth={'2px'}
            borderColor={'white'}
            px={2}
            py={0.5}
            pointerEvents={'none'}
            fontSize={'sm'}
          >
            {activeLayers.size}
          </Text>
        )}
      </Box>
      <MapButton
        onClick={() => {
          setCurrentMapTool(currentMapTool === 'draw' ? null : 'draw');
        }}
        icon={'edit'}
        label={
          isMobile ? t('controller.draw.mobiletext') : t('controller.draw.text')
        }
        active={currentMapTool === 'draw'}
        id="map-draw-button"
      />
      <MapButton
        onClick={() => {
          setCurrentMapTool(
            currentMapTool === 'lidarExtract' ? null : 'lidarExtract',
          );
        }}
        icon={'crop_free'}
        label={
          isMobile
            ? t('controller.lidarExtract.mobiletext')
            : t('controller.lidarExtract.text')
        }
        active={currentMapTool === 'lidarExtract'}
        id="map-lidar-extract-button"
      />
      <MapButton
        onClick={handleShareMapClick}
        icon={'share'}
        label={
          isMobile
            ? t('controller.sharemap.mobiletext')
            : t('controller.sharemap.text')
        }
        id="map-share-button"
      />
      <MapButton
        onClick={() => navigate('/hjelp')}
        icon={'help'}
        label={t('controller.help.mobiletext')}
        active={currentMapTool === 'info'}
        id="map-info-button"
      />
    </HStack>
  );
};

interface MapButtonProps {
  onClick: () => void;
  icon: MaterialSymbol;
  label: string;
  active?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  id?: string;
}
const MapButton = ({
  onClick,
  icon,
  label,
  active,
  ariaLabel,
  disabled,
  id,
}: MapButtonProps) => {
  return (
    <Button
      disabled={disabled}
      w={'fit-content'}
      onClick={() => {
        onClick();
      }}
      variant="ghost"
      colorPalette="green"
      py={{ base: 2, md: 6 }}
      backgroundColor={active ? '#D0ECD6' : ''}
      aria-label={ariaLabel || label}
      id={id}
    >
      <VStack gap={{ base: 0, md: 0 }} align="center" justify="center">
        <Icon icon={icon} />
        <Text
          fontSize="sm"
          fontWeight="medium"
          textAlign="start"
          whiteSpace="no-wrap"
        >
          {label}
        </Text>
      </VStack>
    </Button>
  );
};
