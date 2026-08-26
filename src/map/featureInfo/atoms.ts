import { atom } from 'jotai';
import type { FeatureInfoResult, LayerFeatureInfo } from './types';

export const featureInfoResultAtom = atom<FeatureInfoResult | null>(null);

export const featureInfoLoadingAtom = atom<boolean>(false);

export const featureInfoPanelOpenAtom = atom<boolean>(false);

export interface KulturminnerPopupState {
  coordinate: [number, number];
  layers: LayerFeatureInfo[];
}

export const kulturminnerPopupAtom = atom<KulturminnerPopupState | null>(null);
