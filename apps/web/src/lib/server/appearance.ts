import type { GotoConfiguration } from '@goto/config';
import { getContrastBackground, getContrastText } from './color.js';

export function themeStyleTag(appearance: GotoConfiguration['appearance']): string {
	const { primary_light_color: light, primary_dark_color: dark } = appearance;
	const onLight = getContrastText(light, '#171717');
	const onDark = getContrastText(dark, '#f5f5f5');
	const fillLight = getContrastBackground(light, onLight);
	const fillDark = getContrastBackground(dark, onDark);
	return `<style>:root{--color-primary:light-dark(${light},${dark});--color-on-primary:light-dark(${onLight},${onDark});--color-primary-fill:light-dark(${fillLight},${fillDark})}</style>`;
}
