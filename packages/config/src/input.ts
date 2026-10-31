import { ConfigError } from './errors.js';

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

export function assertSafeInput(value: unknown): asserts value is Record<string, unknown> {
	if (!isPlainObject(value)) throw new ConfigError();
	inspectValue(value, new Set());
}

function inspectValue(value: unknown, ancestors: Set<object>): void {
	if (typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number' && Number.isFinite(value)) return;
	if (Array.isArray(value)) {
		inspectArray(value, ancestors);
		return;
	}
	if (!isPlainObject(value) || ancestors.has(value)) throw new ConfigError();
	ancestors.add(value);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	for (const key of Reflect.ownKeys(descriptors)) {
		if (typeof key !== 'string') throw new ConfigError();
		const descriptor = descriptors[key];
		if (unsafeKeys.has(key) || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new ConfigError();
		}
		inspectValue(descriptor.value, ancestors);
	}
	ancestors.delete(value);
}

function inspectArray(value: unknown[], ancestors: Set<object>): void {
	if (Object.getPrototypeOf(value) !== Array.prototype || ancestors.has(value)) {
		throw new ConfigError();
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(descriptors).length !== value.length + 1) throw new ConfigError();
	ancestors.add(value);
	for (let index = 0; index < value.length; index++) {
		const descriptor = descriptors[String(index)];
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new ConfigError();
		}
		inspectValue(descriptor.value, ancestors);
	}
	ancestors.delete(value);
}

export function assertArrayShapesPreserved(raw: unknown, defaulted: unknown): void {
	if (typeof raw !== 'object' || raw === null) return;
	if (Array.isArray(raw) !== Array.isArray(defaulted)) throw new ConfigError();
	for (const [key, value] of Object.entries(raw)) {
		const next =
			typeof defaulted === 'object' && defaulted !== null
				? (defaulted as Record<string, unknown>)[key]
				: undefined;
		assertArrayShapesPreserved(value, next);
	}
}
