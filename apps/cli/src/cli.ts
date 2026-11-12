import { ConfigError, formatConfigError, loadConfigFile, type ConfigOptions } from '@goto/config';
import { cli, define, type CommandContext } from 'gunshi';

interface CliOutput {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
}

const header = `Goto — configuration validation.
Validates resolved deployment values, including environment interpolation.
Path selection: explicit path, then CONFIG_PATH, then config/goto.yaml.`;

const rootCommand = define({
	name: 'goto-cli',
	description: 'Goto configuration tools.',
	run() {
		throw new Error('A command is required.');
	}
});

export async function runCli(
	args: readonly string[],
	output: CliOutput,
	options?: ConfigOptions
): Promise<0 | 1> {
	const validateCommand = define({
		name: 'validate',
		description: 'Validate YAML and resolved environment values without printing configuration.',
		args: {
			path: { type: 'positional', required: false, description: 'Path to the YAML configuration.' }
		},
		async run(context) {
			await loadConfigFile(context.values.path, options);
			return 'Configuration is valid.';
		}
	});
	const configCommand = define({
		name: 'config',
		description: 'Configuration tools.',
		subCommands: { validate: validateCommand },
		run() {
			throw new Error('A config command is required.');
		}
	});
	const forwarded = args[0] === '--' ? args.slice(1) : [...args];
	try {
		const result = await cli(forwarded, rootCommand, {
			name: 'goto-cli',
			usageSilent: true,
			renderHeader: async () => header,
			renderValidationErrors: null,
			onBeforeCommand: rejectUnexpectedArguments,
			subCommands: { config: configCommand }
		});
		if (result) output.stdout(`${result}\n`);
		return 0;
	} catch (error) {
		const message =
			error instanceof ConfigError
				? `${formatConfigError(error, 'Configuration validation failed.')}\n`
				: 'Command failed. Run goto-cli --help for usage.\n';
		output.stderr(message);
		return 1;
	}
}

function rejectUnexpectedArguments(context: Readonly<CommandContext>): void {
	// Gunshi permits unknown options and unused positionals by default.
	const definitions = Object.entries(context.args);
	const positionalCount = definitions.filter(([, schema]) => schema.type === 'positional').length;
	if (context.positionals.includes('')) throw new Error('Empty positional argument.');
	const suppliedPositionals = context.positionals.slice(context.commandPath.length);
	if (suppliedPositionals.length > positionalCount) {
		throw new Error('Unexpected positional arguments.');
	}
	for (const token of context.tokens) {
		if (token.kind === 'option-terminator') throw new Error('Unexpected separator.');
		if (token.kind !== 'option') continue;
		const optionEntry = definitions.find(([name, schema]) => {
			if (schema.type === 'positional') return false;
			if (token.rawName === `--${name}`) return true;
			return schema.short !== undefined && token.rawName === `-${schema.short}`;
		});
		if (!optionEntry) throw new Error('Unknown option.');
		const [, definition] = optionEntry;
		if (definition.type === 'boolean' && token.value !== undefined) {
			throw new Error('Boolean option does not take a value.');
		}
	}
}
