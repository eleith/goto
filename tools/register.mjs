// Development only: Node strips types; this hook resolves .js source imports to .ts.
import { registerHooks } from 'node:module';
import { resolve } from './hooks.mjs';

registerHooks({ resolve });
