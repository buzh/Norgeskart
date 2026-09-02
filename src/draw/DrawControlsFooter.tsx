import {
  Accordion,
  AccordionItem,
  AccordionItemContent,
  AccordionItemTrigger,
  Button,
  Grid,
  HStack,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTitle,
  PopoverTrigger,
} from '@kvib/react';
import { t } from 'i18next';
import { useSetAtom } from 'jotai';
import { useState } from 'react';
import { useIsMobileScreen } from '../shared/hooks';
import {
  isExportDialogOpenAtom,
  isImportDialogOpenAtom,
} from './dialogs/atoms';
import { ExportDialog } from './dialogs/ExportDialog';
import { ImportDialog } from './dialogs/import/ImportDialog';
import { useDrawSettings } from './drawControls/hooks/drawSettings';

export const DrawControlFooter = () => {
  const { clearDrawing } = useDrawSettings();
  const setIsExportDialogOpen = useSetAtom(isExportDialogOpenAtom);
  const setIsImportDialogOpen = useSetAtom(isImportDialogOpenAtom);

  const [clearPopoverOpen, setClearPopoverOpen] = useState(false);

  const isMobile = useIsMobileScreen();

  const defaultAccordionValue: string[] = isMobile ? [] : ['export'];

  return (
    <>
      <Accordion
        collapsible
        variant="plain"
        size="sm"
        paddingTop={2}
        paddingX={0}
        overflow={'hidden'}
        defaultValue={defaultAccordionValue}
      >
        <AccordionItem value="export" paddingX="0">
          <AccordionItemTrigger fontWeight="600" padding="0">
            {t('controller.export')}
          </AccordionItemTrigger>
          <AccordionItemContent marginX="-25px" mt={2}>
            <Grid templateColumns="repeat(2, max-content)" gap={1}>
              <PopoverRoot
                open={clearPopoverOpen}
                onOpenChange={(e) => setClearPopoverOpen(e.open)}
              >
                <PopoverTrigger asChild>
                  <Button
                    width="fit-content"
                    leftIcon="delete"
                    size="xs"
                    variant="ghost"
                    iconFill
                    colorPalette={'red'}
                  >
                    {t('draw.clear')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent width="250px">
                  <PopoverArrow />
                  <PopoverBody>
                    <PopoverTitle>{t('draw.confrimClear')}</PopoverTitle>
                    <HStack mt={2} justifyContent="space-between">
                      <Button
                        onClick={() => {
                          setClearPopoverOpen(false);
                          clearDrawing();
                        }}
                        colorPalette={'red'}
                        size="xs"
                      >
                        {t('shared.yes')}
                      </Button>
                      <Button
                        onClick={() => {
                          setClearPopoverOpen(false);
                        }}
                        variant="ghost"
                        size="xs"
                      >
                        {t('shared.cancel')}
                      </Button>
                    </HStack>
                  </PopoverBody>
                </PopoverContent>
              </PopoverRoot>

              <Button
                leftIcon="download"
                variant="ghost"
                width="fit-content"
                size="xs"
                onClick={() => setIsExportDialogOpen(true)}
              >
                {t('draw.download')}
              </Button>
              <Button
                width="fit-content"
                size="xs"
                leftIcon="upload"
                variant="ghost"
                onClick={() => setIsImportDialogOpen(true)}
              >
                {t('draw.uploadButton.label')}
              </Button>
            </Grid>
          </AccordionItemContent>
        </AccordionItem>
      </Accordion>
      <ExportDialog />
      <ImportDialog />
    </>
  );
};
