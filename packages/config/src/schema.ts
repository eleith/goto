import {
	FormatRegistry,
	Type,
	type SchemaOptions,
	type Static,
	type TSchema
} from '@sinclair/typebox';
import { hasControlCharacters } from './text.js';

const ref = <T extends TSchema>(schema: T, options?: SchemaOptions) => {
	if (typeof schema.$id !== 'string') throw new Error('Configuration reference needs an ID');
	return Type.Unsafe<Static<T>>(Type.Ref(schema.$id, options));
};

function parseHttpUrl(value: string): URL | undefined {
	try {
		if (/\s/.test(value) || hasControlCharacters(value) || !/^https?:\/\//i.test(value))
			return undefined;
		const url = new URL(value);
		if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0) {
			return url;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

FormatRegistry.Set('goto-http-url', (value) => parseHttpUrl(value) !== undefined);

FormatRegistry.Set('goto-link-url', (value) => {
	const url = parseHttpUrl(value);
	return url !== undefined && url.username === '' && url.password === '';
});

FormatRegistry.Set('goto-site-url', (value) => {
	const url = parseHttpUrl(value);
	return url !== undefined && url.port !== '0' && value === url.origin;
});

const end = '(?![\\s\\S])';
const hostnamePattern = '[^\\s/\\\\?#@:\\[\\]A-Z%]+';
const ipv6Pattern = '\\[[0-9a-f:.]+\\]';
const hostPattern = `(?:${hostnamePattern}|${ipv6Pattern})`;
const httpsPortPattern = `(?::(?!443${end})[1-9][0-9]*)?`;
const httpPortPattern = `(?::(?!80${end})[1-9][0-9]*)?`;
const siteOriginPattern = `^(?:https://${hostPattern}${httpsPortPattern}|http://${hostPattern}${httpPortPattern})${end}`;
const instantPattern = `^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})${end}`;

FormatRegistry.Set('goto-instant', (value) => {
	if (!new RegExp(instantPattern).test(value) || !Number.isFinite(Date.parse(value))) return false;
	const date = value.slice(0, 10);
	const calendar = new Date(`${date}T00:00:00Z`);
	return Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === date;
});

const nonBlankText = { minLength: 1, pattern: '\\S' };
const imageSegment = '(?!\\.{1,2}(?:/|$))[^/%\\\\?#\\x00-\\x1f\\x7f]+';

const HttpUrlSchema = Type.String({
	$id: 'HttpUrl',
	format: 'goto-http-url',
	pattern: `^[Hh][Tt][Tt][Pp][Ss]?://[^\\s]+${end}`,
	description: 'An absolute HTTP or HTTPS URL.'
});

const LinkUrlSchema = Type.String({
	$id: 'LinkUrl',
	format: 'goto-link-url',
	pattern: `^[Hh][Tt][Tt][Pp][Ss]?://[^\\s]+${end}`,
	description: 'An absolute HTTP or HTTPS destination without embedded credentials.'
});

const SiteUrlSchema = Type.String({
	$id: 'SiteUrl',
	format: 'goto-site-url',
	pattern: siteOriginPattern,
	description:
		'The canonical admin HTTP(S) origin, without credentials, path, trailing slash, query or fragment.'
});

const InstantSchema = Type.String({
	$id: 'Instant',
	format: 'goto-instant',
	pattern: instantPattern,
	description:
		'An absolute ISO timestamp with seconds and an explicit Z or numeric timezone offset.'
});

const AuthSecretSchema = Type.String({
	$id: 'AuthSecret',
	...nonBlankText,
	minLength: 32
});

const LocalImagePathSchema = Type.String({
	$id: 'LocalImagePath',
	pattern: `^/public/(?:${imageSegment}/)*${imageSegment}\\.(?:[sS][vV][gG]|[pP][nN][gG]|[jJ][pP][eE]?[gG]|[gG][iI][fF]|[wW][eE][bB][pP])${end}`,
	description:
		'A decoded /public/ SVG, PNG, JPEG, GIF or WebP image path without dot segments, percent escapes, backslashes, queries or fragments.'
});

const HexColorSchema = Type.String({
	$id: 'HexColor',
	pattern: `^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})${end}`
});

const TagsSchema = Type.Array(Type.String({ pattern: `^[^\\x00-\\x1f\\x7f]*${end}` }), {
	$id: 'Tags'
});

const RedirectStatusSchema = Type.Union(
	[Type.Literal(301), Type.Literal(302), Type.Literal(307), Type.Literal(308)],
	{ $id: 'RedirectStatus' }
);

const FallbackSchema = Type.Union([Type.Literal(404), ref(LinkUrlSchema)], {
	$id: 'Fallback'
});

const SiteSchema = Type.Object(
	{
		url: ref(SiteUrlSchema, { default: 'http://localhost:3000' }),
		title: Type.String({ ...nonBlankText, default: 'Goto' }),
		logo_path: Type.Optional(ref(LocalImagePathSchema)),
		favicon_path: Type.Optional(ref(LocalImagePathSchema))
	},
	{ $id: 'Site', additionalProperties: false }
);

const AppearanceSchema = Type.Object(
	{
		primary_light_color: ref(HexColorSchema, { default: '#0f766e' }),
		primary_dark_color: ref(HexColorSchema, { default: '#5eead4' })
	},
	{ $id: 'Appearance', additionalProperties: false }
);

const OidcAuthSchema = Type.Object(
	{
		issuer: ref(HttpUrlSchema),
		client_id: Type.String(nonBlankText),
		client_secret: Type.String(nonBlankText),
		name: Type.String({ ...nonBlankText, default: 'Single Sign-On' })
	},
	{ $id: 'OidcAuth', additionalProperties: false }
);

const CredentialsAuthSchema = Type.Object(
	{
		username: Type.String(nonBlankText),
		password: Type.String(nonBlankText)
	},
	{ $id: 'CredentialsAuth', additionalProperties: false }
);

const AuthSchema = Type.Union(
	[
		Type.Object(
			{
				secret: Type.Optional(ref(AuthSecretSchema)),
				oidc: ref(OidcAuthSchema),
				credentials: Type.Optional(Type.Never())
			},
			{ additionalProperties: false, title: 'OIDC' }
		),
		Type.Object(
			{
				secret: Type.Optional(ref(AuthSecretSchema)),
				credentials: ref(CredentialsAuthSchema),
				oidc: Type.Optional(Type.Never())
			},
			{ additionalProperties: false, title: 'Shared username and password' }
		)
	],
	{ $id: 'Auth', description: 'Declare exactly one authentication strategy.' }
);

const DatabaseSchema = Type.Object(
	{
		path: Type.String({ ...nonBlankText, default: './data/goto.sqlite' })
	},
	{ $id: 'Database', additionalProperties: false }
);

const AnalyticsSchema = Type.Object(
	{
		enabled: Type.Boolean({ default: true }),
		retention_days: Type.Integer({ minimum: 1, default: 90 })
	},
	{ $id: 'Analytics', additionalProperties: false }
);

const DefaultsSchema = Type.Object(
	{
		status_code: ref(RedirectStatusSchema, { default: 302 }),
		forward_query: Type.Boolean({ default: false }),
		fallback: ref(FallbackSchema, { default: 404 })
	},
	{ $id: 'Defaults', additionalProperties: false }
);

const DomainDefaultsSchema = Type.Object(
	{
		status_code: Type.Optional(ref(RedirectStatusSchema)),
		forward_query: Type.Optional(Type.Boolean()),
		fallback: Type.Optional(ref(FallbackSchema))
	},
	{
		$id: 'DomainDefaults',
		additionalProperties: false,
		description: 'Omitted settings inherit global defaults. Explicit false overrides true.'
	}
);

const LinkConfigurationSchema = Type.Object(
	{
		url: ref(LinkUrlSchema),
		title: Type.Optional(Type.String(nonBlankText)),
		description: Type.Optional(Type.String()),
		tags: ref(TagsSchema, { default: [] }),
		enabled: Type.Boolean({ default: true }),
		status_code: Type.Optional(ref(RedirectStatusSchema)),
		forward_query: Type.Optional(Type.Boolean()),
		valid_from: Type.Optional(ref(InstantSchema)),
		valid_until: Type.Optional(ref(InstantSchema))
	},
	{
		$id: 'LinkConfiguration',
		additionalProperties: false,
		description:
			'Omitted status_code and forward_query inherit domain defaults, then global defaults.'
	}
);

const DomainConfigurationSchema = Type.Object(
	{
		defaults: ref(DomainDefaultsSchema, { default: {} }),
		links: Type.Record(Type.String(), ref(LinkConfigurationSchema, { default: {} }), {
			additionalProperties: false,
			description:
				'Logical, case-sensitive paths. Keys are never interpolated or percent-decoded. Use readable canonical paths without spaces, trailing slashes, controls, backslashes, dot segments or :?#[]@. The root path / is allowed.'
		})
	},
	{ $id: 'DomainConfiguration', additionalProperties: false }
);

export const GotoConfigurationSchema = Type.Object(
	{
		version: Type.Literal(1, { default: 1 }),
		site: ref(SiteSchema, { default: {} }),
		appearance: ref(AppearanceSchema, { default: {} }),
		auth: ref(AuthSchema),
		database: ref(DatabaseSchema, { default: {} }),
		analytics: ref(AnalyticsSchema, { default: {} }),
		defaults: ref(DefaultsSchema, { default: {} }),
		domains: Type.Record(Type.String(), ref(DomainConfigurationSchema, { default: {} }), {
			additionalProperties: false
		})
	},
	{ $id: 'GotoConfiguration', additionalProperties: false, title: 'Goto configuration' }
);

export const configurationReferences: TSchema[] = [
	HttpUrlSchema,
	LinkUrlSchema,
	SiteUrlSchema,
	InstantSchema,
	AuthSecretSchema,
	LocalImagePathSchema,
	HexColorSchema,
	TagsSchema,
	RedirectStatusSchema,
	FallbackSchema,
	SiteSchema,
	AppearanceSchema,
	OidcAuthSchema,
	CredentialsAuthSchema,
	AuthSchema,
	DatabaseSchema,
	AnalyticsSchema,
	DefaultsSchema,
	DomainDefaultsSchema,
	LinkConfigurationSchema,
	DomainConfigurationSchema
];

export type GotoConfiguration = Static<typeof GotoConfigurationSchema>;
export type LinkConfiguration = Static<typeof LinkConfigurationSchema>;
export type DomainConfiguration = Static<typeof DomainConfigurationSchema>;
export type RedirectStatus = Static<typeof RedirectStatusSchema>;
