import schema from '@goto/config/schema.json' with { type: 'json' };

export function GET(): Response {
	return Response.json(schema, {
		headers: {
			'content-type': 'application/schema+json; charset=utf-8',
			'cache-control': 'no-store'
		}
	});
}
