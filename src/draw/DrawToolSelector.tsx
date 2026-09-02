import { Flex, IconButton, MaterialSymbol, Text } from '@kvib/react';
import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  drawTypeAtom,
  primaryColorAtom,
  secondaryColorAtom,
} from '../settings/draw/atoms';
import { DrawType } from './drawControls/hooks/drawSettings';

export const DrawToolSelector = () => {
  const { t } = useTranslation();
  const drawTypeButtons: {
    value: DrawType;
    icon: MaterialSymbol;
    label: string;
  }[] = [
    {
      value: 'LineString',
      icon: 'diagonal_line',
      label: t('draw.controls.tool.label.linestring'),
    },
    {
      value: 'Polygon',
      icon: 'pentagon',
      label: t('draw.controls.tool.label.polygon'),
    },
    {
      value: 'Point',
      icon: 'atr',
      label: t('draw.controls.tool.label.point'),
    },
    {
      value: 'Circle',
      icon: 'circle',
      label: t('draw.controls.tool.label.circle'),
    },
    {
      value: 'Text',
      icon: 'text_fields',
      label: t('draw.controls.tool.label.text'),
    },
    {
      value: 'Move',
      icon: 'arrow_selector_tool',
      label: t('draw.controls.tool.label.edit'),
    },
  ];
  return (
    <Flex w="100%" justifyContent={'space-between'}>
      {drawTypeButtons.map((button) => (
        <DrawTypeButton
          key={button.value}
          type={button.value}
          icon={button.icon}
          label={button.label}
        />
      ))}
    </Flex>
  );
};

const DrawTypeButton = ({
  type,
  icon,
  label,
}: {
  type: DrawType;
  icon: MaterialSymbol;
  label: string;
}) => {
  const [drawType, setDrawType] = useAtom(drawTypeAtom);
  const isCurrentTool = drawType === type;

  const setPrimaryColor = useSetAtom(primaryColorAtom);
  const setSecondaryColor = useSetAtom(secondaryColorAtom);

  return (
    <Flex direction="column" align="center" gap={1}>
      <IconButton
        variant="ghost"
        iconFill
        icon={icon}
        backgroundColor={isCurrentTool ? '#D0ECD6' : ''}
        size={{ base: 'xs', md: 'sm' }}
        onClick={() => {
          if (isCurrentTool) {
            return;
          }

          if (type === 'Text') {
            setPrimaryColor('#000000');
            setSecondaryColor('#ffffffff');
          }
          setDrawType(type);
        }}
      />
      <Text fontSize={12}>{label}</Text>
    </Flex>
  );
};
