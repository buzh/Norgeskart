import { Button, HStack, Stack, toaster, Tooltip } from '@kvib/react';
import { useAtomValue } from 'jotai';
import { transform } from 'ol/proj';
import { useTranslation } from 'react-i18next';
import { mapAtom } from '../../../map/atoms';
import { ProjectionIdentifier } from '../../../map/projections/types';
import { decimalToDMS } from '../../../shared/utils/coordinateCalculations';
import { CoordinateText } from './CoordinateText';

interface CoordinateInfoProps {
  lat: number;
  lon: number;
  inputCRS: ProjectionIdentifier;
}
export const CoordinateInfo = ({ lat, lon, inputCRS }: CoordinateInfoProps) => {
  const map = useAtomValue(mapAtom);
  const { t } = useTranslation();
  const projection = map
    .getView()
    .getProjection()
    .getCode() as ProjectionIdentifier;

  const [x, y] = transform([lon, lat], inputCRS, projection);

  const isGeographic =
    projection === 'EPSG:4326' || projection === 'EPSG:4258';
  const showsDMS =
    projection === 'EPSG:4326' ||
    projection === 'EPSG:4230' ||
    projection === 'EPSG:4258';
  const onCopyClick = () => {
    const decimals = isGeographic ? 7 : 2;
    const coordString = isGeographic
      ? `${y.toFixed(decimals)} ${x.toFixed(decimals)}`
      : `${x.toFixed(decimals)},${y.toFixed(decimals)}@${projection}`;

    navigator.clipboard.writeText(coordString);
    toaster.create({
      title: t('infoBox.coordinateSection.copy.toast.title'),
      duration: 2000,
    });
  };

  const onCopyDMSClick = () => {
    const formatDMS = (value: number) => {
      const dms = decimalToDMS(value);
      const sign = dms.sign < 0 ? '-' : '';
      return `${sign}${dms.deg}° ${dms.min}' ${dms.sec}"`;
    };
    const coordString = isGeographic
      ? `${formatDMS(y)} N, ${formatDMS(x)} E`
      : `${formatDMS(x)}, ${formatDMS(y)}`;

    navigator.clipboard.writeText(coordString);
    toaster.create({
      title: t('infoBox.coordinateSection.copyDMS.toast.title'),
      duration: 2000,
    });
  };

  return (
    <Stack fontSize={14}>
      <CoordinateText
        x={x}
        y={y}
        useDMS={showsDMS}
        isGeographicProjection={isGeographic}
      />
      <HStack>
        <Tooltip
          content={t('infoBox.coordinateSection.copy.toast.title')}
          portalled={false}
          positioning={{ placement: 'top' }}
        >
          <Button
            onClick={onCopyClick}
            leftIcon={'content_copy'}
            w={'fit-content'}
            variant="secondary"
            size="xs"
          >
            {showsDMS
              ? t('infoBox.coordinateSection.copy.label_geo')
              : t('infoBox.coordinateSection.copy.label')}
          </Button>
        </Tooltip>
        {showsDMS && (
          <Tooltip
            content={t('infoBox.coordinateSection.copyDMS.toast.title')}
            portalled={false}
            positioning={{ placement: 'top' }}
          >
            <Button
              onClick={onCopyDMSClick}
              leftIcon={'content_copy'}
              w={'fit-content'}
              variant="secondary"
              size="xs"
            >
              {t('infoBox.coordinateSection.copyDMS.label')}
            </Button>
          </Tooltip>
        )}
      </HStack>
    </Stack>
  );
};
