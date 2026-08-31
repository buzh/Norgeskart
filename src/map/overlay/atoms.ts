import { atom } from 'jotai';
import { MapTool } from '../../Layout';

export const mapToolAtom = atom<MapTool>(null);

export const drawPanelCollapsedAtom = atom(false);
