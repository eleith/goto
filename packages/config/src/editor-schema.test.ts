import { readFileSync } from 'node:fs';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { createEditorSchema } from './editor-schema.js';
import { interpolate } from './interpolate.js';
import { configurationReferences, GotoConfigurationSchema } from './schema.js';

type ObjectSchema = Record<string, unknown>;
const object = (value: unknown) => value as ObjectSchema;
const property = (schema: ObjectSchema, key: string) => object(object(schema.properties)[key]);
const definition = (schema: ObjectSchema, key: string) => object(object(schema.$defs)[key]);
const branches = (schema: ObjectSchema) => schema.anyOf as ObjectSchema[];

function interpolationPattern(schema: ObjectSchema): RegExp {
	expect(branches(schema)).toHaveLength(2);
	expect(branches(schema)[1]).toEqual({ type: 'string', pattern: expect.any(String) });
	return new RegExp(String(branches(schema)[1]!.pattern));
}

describe('Goto editor schema', () => {
	it('relaxes defaulted fields while keeping authentication, domain links and destinations required', () => {
		const editor = createEditorSchema();
		expect(editor.required).toEqual(['auth', 'domains']);
		for (const name of ['Url', 'Site', 'Appearance', 'Database', 'Analytics', 'Defaults']) {
			expect(definition(editor, name).required).toBeUndefined();
		}
		expect(property(editor, 'site')).toEqual({ $ref: '#/$defs/Site', default: {} });
		expect(object(definition(editor, 'Site').properties)).not.toHaveProperty('url');
		expect(property(editor, 'url')).toEqual({ $ref: '#/$defs/Url', default: {} });
		expect(property(definition(editor, 'Url'), 'app')).toEqual({
			$ref: '#/$defs/AppUrl',
			default: 'http://localhost:3000'
		});
		expect(property(definition(editor, 'Url'), 'worker')).toEqual({
			$ref: '#/$defs/BaseUrl',
			default: 'http://goto-worker:9000'
		});
		expect(definition(editor, 'DomainConfiguration').required).toEqual(['links']);
		expect(definition(editor, 'LinkConfiguration').required).toEqual(['url']);
		expect(property(definition(editor, 'LinkConfiguration'), 'url')).toEqual({
			$ref: '#/$defs/LinkUrl'
		});
		expect(property(definition(editor, 'LinkConfiguration'), 'tags').default).toEqual([]);
		expect(property(definition(editor, 'LinkConfiguration'), 'enabled')).toEqual({
			type: 'boolean',
			default: true
		});
		expect(definition(editor, 'CredentialsAuth').required).toEqual(['username', 'password']);
		expect(definition(editor, 'OidcAuth').required).toEqual([
			'issuer',
			'client_id',
			'client_secret'
		]);
		expect(branches(definition(editor, 'Auth')).map((branch) => branch.required)).toEqual([
			['oidc'],
			['credentials']
		]);
		for (const branch of branches(definition(editor, 'Auth'))) {
			expect(property(branch, 'secret')).toEqual({ $ref: '#/$defs/AuthSecret' });
			expect(branch.additionalProperties).toBe(false);
		}
		expect(definition(editor, 'AuthSecret')).not.toHaveProperty('default');
	});

	it('preserves traversal defaults on record values without inventing inherited overrides', () => {
		const editor = createEditorSchema();
		for (const [record, target] of [
			[property(editor, 'domains'), 'DomainConfiguration'],
			[property(definition(editor, 'DomainConfiguration'), 'links'), 'LinkConfiguration']
		] as const) {
			expect(record.additionalProperties).toBe(false);
			expect(Object.values(object(record.patternProperties))).toEqual([
				{ $ref: `#/$defs/${target}`, default: {} }
			]);
		}
		for (const name of ['DomainDefaults', 'LinkConfiguration']) {
			const schema = definition(editor, name);
			for (const field of ['status_code', 'forward_query']) {
				expect(property(schema, field)).not.toHaveProperty('default');
				expect(schema.required ?? []).not.toContain(field);
			}
		}
		expect(property(definition(editor, 'DomainDefaults'), 'fallback')).not.toHaveProperty(
			'default'
		);
		expect(property(definition(editor, 'Defaults'), 'status_code').default).toBe(302);
		expect(property(definition(editor, 'Defaults'), 'forward_query')).toEqual({
			type: 'boolean',
			default: false
		});
		expect(property(definition(editor, 'Defaults'), 'fallback').default).toBe(404);
	});

	it('maps runtime formats to editor formats and keeps literal constraints separate from tokens', () => {
		const editor = createEditorSchema();
		for (const name of ['HttpUrl', 'LinkUrl', 'AppUrl', 'BaseUrl', 'Instant']) {
			const canonical = configurationReferences.find((schema) => schema.$id === name)!;
			const adapted = definition(editor, name);
			expect(branches(adapted)[0]).toEqual({
				type: 'string',
				format: name === 'Instant' ? 'date-time' : 'uri',
				pattern: canonical.pattern
			});
			expect(adapted).not.toHaveProperty('format');
			expect(adapted).not.toHaveProperty('pattern');
			expect(adapted.description).toBe(canonical.description);
			expect(interpolationPattern(adapted).test('${VALUE}')).toBe(true);
		}
		expect(branches(definition(editor, 'AuthSecret'))[0]).toEqual({
			type: 'string',
			minLength: 32,
			pattern: '\\S'
		});
	});

	it('produces self-contained local references with no publication ID', () => {
		const editor = createEditorSchema();
		expect(editor.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
		function inspect(value: unknown): void {
			if (typeof value !== 'object' || value === null) return;
			if (Array.isArray(value)) {
				value.forEach(inspect);
				return;
			}
			const node = object(value);
			expect(node.$id).toBeUndefined();
			if (typeof node.$ref === 'string') {
				expect(node.$ref.startsWith('#/$defs/')).toBe(true);
				let target: unknown = editor;
				for (const part of node.$ref.slice(2).split('/')) {
					target = object(target)[part.replaceAll('~1', '/').replaceAll('~0', '~')];
					expect(target).toBeDefined();
				}
			}
			Object.values(node).forEach(inspect);
		}
		inspect(editor);
		expect(Object.keys(object(editor.$defs))).toEqual(
			configurationReferences.map((schema) => schema.$id)
		);
	});

	it('walks map values, array items, union branches and additional property schemas', () => {
		const member = Type.Object({
			title: Type.String({ pattern: '\\S' }),
			enabled: Type.Boolean({ default: true })
		});
		const editor = createEditorSchema(
			Type.Object(
				{
					map: Type.Record(Type.String(), member),
					array: Type.Array(member),
					union: Type.Union([member, Type.Number()])
				},
				{ additionalProperties: member }
			),
			[]
		);
		const members = [
			object(Object.values(object(property(editor, 'map').patternProperties))[0]),
			object(property(editor, 'array').items),
			branches(property(editor, 'union'))[0]!,
			object(editor.additionalProperties)
		];
		for (const adapted of members) {
			expect(adapted.required).toEqual(['title']);
			expect(interpolationPattern(property(adapted, 'title')).test('${TITLE}')).toBe(true);
		}
	});

	it('follows referenced defaults, escapes pointer IDs and terminates reference cycles', () => {
		const text = Type.String({ $id: 'Text/with~default', default: '' });
		const first = Type.Ref('Second', { $id: 'First' });
		const second = Type.Ref('First', { $id: 'Second' });
		const editor = createEditorSchema(
			Type.Object({ text: Type.Ref(text.$id!), cyclic: Type.Ref('First') }),
			[text, first, second]
		);
		expect(editor.required).toEqual(['cyclic']);
		expect(property(editor, 'text')).toEqual({ $ref: '#/$defs/Text~1with~0default' });
		expect(definition(editor, 'Text/with~default').default).toBe('');
	});

	it('preserves annotations, falsy defaults and non-string types without coercion', () => {
		const annotation = { $id: 'data', $ref: 'literal', type: 'string', pattern: 'keep' };
		const editor = createEditorSchema(
			Type.Object({
				choice: Type.String({ enum: ['first', 'second'], default: '', examples: [annotation] }),
				constant: Type.Literal('fixed'),
				limited: Type.String({ minLength: 2, maxLength: 5, title: 'Limited' }),
				text: Type.String(),
				flag: Type.Boolean({ default: false }),
				count: Type.Integer({ minimum: 1, default: 90 }),
				version: Type.Literal(1),
				data: Type.Unknown({ default: annotation })
			}),
			[]
		);
		expect(property(editor, 'choice')).toMatchObject({ default: '', examples: [annotation] });
		expect(branches(property(editor, 'choice'))[0]).toEqual({
			type: 'string',
			enum: ['first', 'second']
		});
		expect(branches(property(editor, 'constant'))[0]).toEqual({ type: 'string', const: 'fixed' });
		expect(property(editor, 'limited').title).toBe('Limited');
		expect(branches(property(editor, 'limited'))[0]).toEqual({
			type: 'string',
			minLength: 2,
			maxLength: 5
		});
		expect(property(editor, 'text')).toEqual({ type: 'string' });
		expect(property(editor, 'flag')).toEqual({ type: 'boolean', default: false });
		expect(property(editor, 'count')).toEqual({ type: 'integer', minimum: 1, default: 90 });
		expect(property(editor, 'version')).toEqual({ type: 'number', const: 1 });
		expect(property(editor, 'data').default).toEqual(annotation);
	});

	it.each([
		['${HOST}', true],
		['${_HOST_2}', true],
		['${HOST:-}', true],
		['${HOST:-line one\nline two}', true],
		['${HOST:-${OTHER}}', true],
		['prefix ${HOST} suffix', true],
		['$$${HOST}', true],
		['$${ESCAPED} then ${HOST}', true],
		['javascript:${HOST}', true],
		['${host}', false],
		['${1HOST}', false],
		['${HOST.NAME}', false],
		['${HOST-default}', false],
		['${HOST', false],
		['$HOST', false],
		['$${HOST}', false],
		['$$$$${HOST}', true],
		['prefix $${HOST:-fallback}', false],
		['javascript:alert(1)', false],
		['javascript:$${HOST}', false],
		['https://', false]
	] as const)('keeps the token exception compatible with the parser for %j', (value, expected) => {
		const pattern = interpolationPattern(definition(createEditorSchema(), 'HttpUrl'));
		expect(pattern.test(value)).toBe(expected);
		const resolved = interpolate(value, { HOST: 'resolved', _HOST_2: 'resolved' });
		expect(String(resolved).includes('resolved')).toBe(expected);
	});

	it('keeps map-key constraints literal and never interpolates keys', () => {
		const editor = createEditorSchema(
			Type.Record(Type.String({ pattern: '^[a-z]+$' }), Type.String({ pattern: '^ready$' }), {
				propertyNames: Type.String({ pattern: '^allowed$', enum: ['allowed'] }),
				additionalProperties: false
			}),
			[]
		);
		expect(editor.propertyNames).toEqual({
			type: 'string',
			pattern: '^allowed$',
			enum: ['allowed']
		});
		expect(Object.keys(object(editor.patternProperties))).toEqual(['^[a-z]+$']);
		expect(editor.additionalProperties).toBe(false);
		expect(
			interpolationPattern(object(object(editor.patternProperties)['^[a-z]+$'])).test('${HOST}')
		).toBe(true);
		const goto = createEditorSchema();
		expect(Object.keys(object(property(goto, 'domains').patternProperties))).toEqual(
			Object.keys(GotoConfigurationSchema.properties.domains.patternProperties)
		);
		expect(interpolate({ '${HOST}': '${HOST}' }, { HOST: 'ready' })).toEqual({
			'${HOST}': 'ready'
		});
	});

	it('does not mutate canonical schemas and produces deterministic output', () => {
		const before = JSON.stringify([GotoConfigurationSchema, configurationReferences]);
		const first = JSON.stringify(createEditorSchema());
		expect(JSON.stringify(createEditorSchema())).toBe(first);
		expect(JSON.stringify([GotoConfigurationSchema, configurationReferences])).toBe(before);
		for (const name of ['HttpUrl', 'LinkUrl', 'AppUrl', 'BaseUrl', 'Instant', 'AuthSecret']) {
			const canonical = configurationReferences.find((schema) => schema.$id === name)!;
			for (const value of ['${VALUE}', false, 1]) {
				expect(Value.Check(canonical, value)).toBe(false);
			}
		}
	});

	it('matches the committed artifact through the public package export', () => {
		const committed = readFileSync(new URL('./config.schema.json', import.meta.url), 'utf8');
		const exported = readFileSync(new URL(import.meta.resolve('@goto/config/schema.json')), 'utf8');
		expect(exported).toBe(committed);
		expect(JSON.parse(exported)).toEqual(createEditorSchema());
	});

	it('rejects unresolved references and missing or duplicate reference IDs', () => {
		expect(() => createEditorSchema(Type.Ref('Missing'), [])).toThrow(
			'Unresolved editor schema reference'
		);
		expect(() => createEditorSchema(Type.Object({}), [Type.String()])).toThrow(
			'unique reference IDs'
		);
		expect(() =>
			createEditorSchema(Type.Object({}), [
				Type.String({ $id: 'Same' }),
				Type.Number({ $id: 'Same' })
			])
		).toThrow('unique reference IDs');
	});
});
