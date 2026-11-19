import {
	FormatRegistry,
	Type,
	type SchemaOptions,
	type Static,
	type TSchema
} from '@sinclair/typebox';
import { languageTagPattern } from './languages.js';
import { reservedStaticPrefix } from './paths.js';
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

FormatRegistry.Set('goto-base-url', (value) => {
	const url = parseHttpUrl(value);
	return (
		url !== undefined &&
		url.username === '' &&
		url.password === '' &&
		!value.includes('?') &&
		!value.includes('#')
	);
});

FormatRegistry.Set('goto-app-url', (value) => {
	const url = parseHttpUrl(value);
	return url !== undefined && url.port !== '0' && value === url.origin;
});

const end = '(?![\\s\\S])';
const hostnamePattern = '[^\\s/\\\\?#@:\\[\\]A-Z%]+';
const ipv6Pattern = '\\[[0-9a-f:.]+\\]';
const hostPattern = `(?:${hostnamePattern}|${ipv6Pattern})`;
const httpsPortPattern = `(?::(?!443${end})[1-9][0-9]*)?`;
const httpPortPattern = `(?::(?!80${end})[1-9][0-9]*)?`;
const appOriginPattern = `^(?:https://${hostPattern}${httpsPortPattern}|http://${hostPattern}${httpPortPattern})${end}`;
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

const BaseUrlSchema = Type.String({
	$id: 'BaseUrl',
	format: 'goto-base-url',
	pattern: `^[Hh][Tt][Tt][Pp][Ss]?://[^\\s/@?#]+(?:/[^\\s?#]*)?${end}`,
	description:
		'An absolute HTTP or HTTPS base URL without embedded credentials, query or fragment. A base path and trailing slash are allowed.'
});

const AppUrlSchema = Type.String({
	$id: 'AppUrl',
	format: 'goto-app-url',
	pattern: appOriginPattern,
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

FormatRegistry.Set('goto-tag', (value) => value.isWellFormed());

const TagsSchema = Type.Array(
	Type.String({
		minLength: 1,
		pattern: `^(?=[\\s\\S]*\\S)(?!\\.{1,2}${end})[^\\x00-\\x1f\\x7f]*${end}`,
		format: 'goto-tag'
	}),
	{
		$id: 'Tags',
		description:
			'Literal, case-sensitive labels. Unusable string labels are dropped with configuration warnings.'
	}
);

const RedirectStatusSchema = Type.Union(
	[Type.Literal(301), Type.Literal(302), Type.Literal(307), Type.Literal(308)],
	{ $id: 'RedirectStatus' }
);

const RedirectResponseSchema = Type.Object(
	{
		url: ref(LinkUrlSchema),
		status_code: ref(RedirectStatusSchema, { default: 302 }),
		forward_query: Type.Boolean({ default: false })
	},
	{ $id: 'RedirectResponse', additionalProperties: false }
);

const UrlSchema = Type.Object(
	{
		app: ref(AppUrlSchema, { default: 'http://localhost:3000' }),
		worker: ref(BaseUrlSchema, { default: 'http://goto-worker:9000' })
	},
	{ $id: 'Url', additionalProperties: false }
);

const SiteSchema = Type.Object(
	{
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
		path: Type.String({ ...nonBlankText, default: './data/goto.sqlite' }),
		worker_path: Type.String({ ...nonBlankText, default: './data/worker.sqlite' })
	},
	{ $id: 'Database', additionalProperties: false }
);

const AnalyticsSchema = Type.Object(
	{
		retention_months: Type.Union(
			[Type.Literal(0), Type.Literal(3), Type.Literal(9), Type.Literal(12)],
			{
				default: 3,
				description:
					'Calendar months of detailed analytics history. Zero captures minimal visits for permanent visit totals; the hourly worker counts and then removes them without retaining client details or daily analytics. Stop both services before changing between zero and positive retention, then restart. Positive retention changes reload live.'
			}
		)
	},
	{ $id: 'Analytics', additionalProperties: false }
);

const LinkDefaultsSchema = Type.Object(
	{
		status_code: ref(RedirectStatusSchema, { default: 302 }),
		forward_query: Type.Boolean({ default: false }),
		case_insensitive: Type.Boolean({ default: true }),
		ignore_trailing_slash: Type.Boolean({ default: true }),
		forward_path: Type.Boolean({ default: false })
	},
	{ $id: 'LinkDefaults', additionalProperties: false }
);

const DomainLinkDefaultsSchema = Type.Object(
	{
		status_code: Type.Optional(ref(RedirectStatusSchema)),
		forward_query: Type.Optional(Type.Boolean()),
		case_insensitive: Type.Optional(Type.Boolean()),
		ignore_trailing_slash: Type.Optional(Type.Boolean()),
		forward_path: Type.Optional(Type.Boolean())
	},
	{
		$id: 'DomainLinkDefaults',
		additionalProperties: false,
		description: 'Omitted settings inherit global link_defaults. Explicit false overrides true.'
	}
);

const RedirectRuleSchema = Type.Object(
	{
		if: Type.Object(
			{
				language: Type.Optional(Type.String({ pattern: languageTagPattern })),
				os: Type.Optional(
					Type.Union([
						Type.Literal('ios'),
						Type.Literal('android'),
						Type.Literal('windows'),
						Type.Literal('macos'),
						Type.Literal('linux'),
						Type.Literal('chromeos')
					])
				)
			},
			{ additionalProperties: false, minProperties: 1 }
		),
		to: ref(LinkUrlSchema)
	},
	{ $id: 'RedirectRule', additionalProperties: false }
);

const LinkConfigurationSchema = Type.Object(
	{
		url: ref(LinkUrlSchema),
		redirect: Type.Optional(Type.Array(ref(RedirectRuleSchema))),
		title: Type.Optional(Type.String(nonBlankText)),
		description: Type.Optional(Type.String()),
		tags: ref(TagsSchema, { default: [] }),
		enabled: Type.Boolean({ default: true }),
		max_visits: Type.Optional(
			Type.Integer({
				minimum: 1,
				maximum: Number.MAX_SAFE_INTEGER,
				description:
					'Best-effort limit on qualifying successful GET redirects for this canonical named path. Omit for unlimited visits; not inherited and not an exact quota guarantee.'
			})
		),
		status_code: Type.Optional(ref(RedirectStatusSchema)),
		forward_query: Type.Optional(Type.Boolean()),
		case_insensitive: Type.Optional(Type.Boolean()),
		ignore_trailing_slash: Type.Optional(Type.Boolean()),
		forward_path: Type.Optional(Type.Boolean()),
		valid_from: Type.Optional(ref(InstantSchema)),
		valid_until: Type.Optional(ref(InstantSchema))
	},
	{
		$id: 'LinkConfiguration',
		additionalProperties: false,
		description:
			'Omitted response and matching settings inherit domain link_defaults, then global link_defaults.'
	}
);

const namedLinkKeyPattern = `^(?!${reservedStaticPrefix})/.+`;

const DomainConfigurationSchema = Type.Object(
	{
		link_defaults: ref(DomainLinkDefaultsSchema, { default: {} }),
		root: Type.Optional(ref(RedirectResponseSchema)),
		fallback: Type.Optional(ref(RedirectResponseSchema)),
		links: Type.Record(
			Type.String({ pattern: namedLinkKeyPattern }),
			ref(LinkConfigurationSchema, { default: {} }),
			{
				additionalProperties: false,
				description: `Logical named paths. Keys preserve their spelling and are never interpolated or percent-decoded. Use readable canonical paths without spaces, trailing slashes, controls, backslashes, dot segments or :?#[]. The ${reservedStaticPrefix} prefix is reserved for static files. Configure / with the separate root response.`
			}
		)
	},
	{ $id: 'DomainConfiguration', additionalProperties: false }
);

export const GotoConfigurationSchema = Type.Object(
	{
		version: Type.Literal(1, { default: 1 }),
		url: ref(UrlSchema, { default: {} }),
		site: ref(SiteSchema, { default: {} }),
		appearance: ref(AppearanceSchema, { default: {} }),
		auth: ref(AuthSchema),
		database: ref(DatabaseSchema, { default: {} }),
		analytics: ref(AnalyticsSchema, { default: {} }),
		link_defaults: ref(LinkDefaultsSchema, { default: {} }),
		fallback: Type.Optional(ref(RedirectResponseSchema)),
		domains: Type.Record(Type.String(), ref(DomainConfigurationSchema, { default: {} }), {
			additionalProperties: false
		})
	},
	{ $id: 'GotoConfiguration', additionalProperties: false, title: 'Goto configuration' }
);

export const configurationReferences: TSchema[] = [
	HttpUrlSchema,
	LinkUrlSchema,
	BaseUrlSchema,
	AppUrlSchema,
	InstantSchema,
	AuthSecretSchema,
	LocalImagePathSchema,
	HexColorSchema,
	TagsSchema,
	RedirectStatusSchema,
	RedirectResponseSchema,
	UrlSchema,
	SiteSchema,
	AppearanceSchema,
	OidcAuthSchema,
	CredentialsAuthSchema,
	AuthSchema,
	DatabaseSchema,
	AnalyticsSchema,
	LinkDefaultsSchema,
	DomainLinkDefaultsSchema,
	RedirectRuleSchema,
	LinkConfigurationSchema,
	DomainConfigurationSchema
];

export type GotoConfiguration = Static<typeof GotoConfigurationSchema>;
export type LinkConfiguration = Static<typeof LinkConfigurationSchema>;
export type DomainConfiguration = Static<typeof DomainConfigurationSchema>;
export type RedirectStatus = Static<typeof RedirectStatusSchema>;
export type RedirectResponse = Static<typeof RedirectResponseSchema>;
export type RedirectRule = Static<typeof RedirectRuleSchema>;
