// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

const path = require('path');
const fs = require('fs');

let currentDir;
let extensionsJson = null; // If not null it will look for it
let config = {
	"mapping": {
		"csSession": "crshSession"
	},
	"blockedDefs": [],
	"blockedUnmappedDefs": ["crshSession"],
	"blockedParams": ["self"],
	"root": null,
	"sourceFile": null,
	"parsed": null,
	"disableFromRoot": false,
	"msgOnRootDisabled": false,
	"generatedKeys": ["__source__","__name__","__type__","__def__","__description__","__parameters__"],
	"addParamDefaults": false
};

function extractFromDefSource(source) {
    // Remove leading whitespaces, spaces, and tabs
    source = source.replace(/^\s+|\s+$/g, '');
    
    // Extract function/method name and parameters
    const defMatch = source.match(/^(def|class)\s+(\w+)\((.*)\)/);
    if (!defMatch) return { __source__: source }; // No valid function or class definition found
  
    const [, type, name, paramsStr] = defMatch;
    const params = paramsStr.split(/\s*,\s*/);
  
    // Extract description
    let description = null;
    const descriptionMatch = source.match(/['"]{3}([\s\S]*?)['"]{3}/);
    if (descriptionMatch) {
        description = descriptionMatch[1];
    }
  
    // Construct object with source, parameters, and description
    const result = {
        __source__: source,
        __name__: name,
        __type__: type === "def" ? "func" : type,
		__def__: type,
        __description__: description ? description : "",
		__parameters__: []
    };
  
	let i = 0;
    for (let param of params) {
		if (param.trim() !== '' && !config.blockedParams.includes(param)) {

			let [paramName, defaultValue] = param.split('=').map(part => part.trim());
			let typeHint = null;

			if (paramName.startsWith('"') || paramName.startsWith("'")) {
				result.__parameters__[i-1].defaultValue += ", "+paramName;
			} else {
				// Extracting type hint if present
				const typeHintMatch = paramName.match(/^(.*?):\s*(.*)$/);
				if (typeHintMatch) {
					paramName = typeHintMatch[1].trim();
					typeHint = typeHintMatch[2].trim();
				}
			
				// Create parameter object
				let parameterObject = {
					name: paramName,
					typeHint: typeHint || null,
					defaultValue: defaultValue || null
				};
			
				// Add parameter object to result.__parameters__
				result.__parameters__.push(parameterObject);
				i++;
			}
		}
	}
  
    return result;
}
  
function parsePythonSource(source) {
	const lines = source.split('\n');
	const result = {};
	const indentation = /^\s*/;
	let currentClass = null;
	let currentFunc = null;
	let currentIndentLevel = null;
  
	function getCodeBlock(startIndex) {
	    const blockLines = [];
	    const initialIndent = lines[startIndex].match(indentation)[0].length;
  
	    for (let i = startIndex; i < lines.length; i++) {
			const currentIndent = lines[i].match(indentation)[0].length;
  
			if (i > startIndex && currentIndent <= initialIndent && lines[i].trim()) {
				break;
			}
  
			blockLines.push(lines[i]);
	  	}
  
	  	return blockLines.join('\n');
	}
  
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const classMatch = line.match(/^class\s+(\w+)/);
		const funcMatch = line.match(/^def\s+(\w+)/);
		const methodMatch = line.match(/^\s+def\s+(\w+)/);
  
		if (classMatch) {
			currentClass = classMatch[1];
			currentIndentLevel = line.match(indentation)[0].length;
			result[currentClass] = extractFromDefSource(getCodeBlock(i));
			currentFunc = null;
		} else if (funcMatch) {
			currentIndentLevel = line.match(indentation)[0].length;
			if (currentClass) {
				currentFunc = funcMatch[1];
				result[currentClass][currentFunc] = extractFromDefSource(getCodeBlock(i));
			} else {
				result[funcMatch[1]] = extractFromDefSource(getCodeBlock(i));
				currentFunc = null;
			}
		} else if (methodMatch && currentClass) {
			currentFunc = methodMatch[1];
			result[currentClass][currentFunc] = extractFromDefSource(getCodeBlock(i));
		}

	}

	for (const value of Object.values(result)) {
		if (value.__parameters__.length === 0 && value.__type__ === "class" && value.hasOwnProperty("__init__")) {
			value.__parameters__ = value["__init__"].__parameters__;
		}
	}
  
	return result;
}

function cutAndRejoin(str,delim="(") {
	// Split the string by "("
	let parts = str.split(delim);
	
	// Remove the last part
	parts.pop();
	
	// Rejoin the remaining parts with "("
	let result = parts.join(delim);
	
	return result;
}
  
function removeLastOutermostParenthesesContent(str) {
	// This regex finds all outermost parentheses and their contents
	const regex = /\([^()]*\)/g;
	
	// Find all matches
	const matches = [];
	let match;
	while ((match = regex.exec(str)) !== null) {
	  matches.push(match);
	}
  
	// If there are no matches, return the original string
	if (matches.length === 0) {
	  return str;
	}
  
	// Get the last match
	const lastMatch = matches[matches.length - 1];
  
	// Remove the last match from the string
	const result = str.slice(0, lastMatch.index) + str.slice(lastMatch.index + lastMatch[0].length);
  
	return result;
}

function parseLastMethod(str) {
	str = removeLastOutermostParenthesesContent(str);
	if (str.includes(')')) {
		// Split the string by ")" and keep only the last part
		const parts = str.split(')');
		return parts[parts.length - 1];
	} else {
		return str;
	}
  }

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "crshmodulo-helper-v1" is now active!');

	const activeEditor = vscode.window.activeTextEditor;

	if (activeEditor) {

		// Check for cslib
		if (!extensionsJson || extensionsJson == null || extensionsJson == undefined) {
			currentDir = path.dirname(activeEditor.document.uri.fsPath);
			while (true) {
				const possibleExtensionsJson = path.join(currentDir, "assets", "extensions.json");
				if (fs.existsSync(possibleExtensionsJson) && fs.statSync(possibleExtensionsJson).isFile()) {
					extensionsJson = possibleExtensionsJson;
					break;
				}

				const parentDir = path.dirname(currentDir);
				if (parentDir === currentDir) {
					// Reached the root of the file system
					break;
				}
				currentDir = parentDir;
			}
		}

		// Parse the extensions.json file and get the path to main.py
		if (extensionsJson && extensionsJson != null && extensionsJson != undefined) {
			const fileConfig = JSON.parse( fs.readFileSync(extensionsJson, 'utf-8') );
			if (fileConfig.hasOwnProperty("crshmodulo_helper_v1")) {
				for (const [k,v] of Object.entries(fileConfig.crshmodulo_helper_v1)) {
					config[k] = v;
				}
			}
			if (fileConfig.crshmodulo_helper_v1.hasOwnProperty("sourceFile")) {
				if (config.sourceFile.startsWith("../")) {
					config.sourceFile = "./" + config.sourceFile;
				}
				if (config.sourceFile.startsWith("./")) {
					config.sourceFile = path.resolve( path.join( path.dirname(extensionsJson), config.sourceFile.replace(/^\.\//, "") ) );
				}
			}
			if (fileConfig.crshmodulo_helper_v1.hasOwnProperty("root")) {
				if (config.root.startsWith("../")) {
					config.root = "./" + config.root;
				}
				if (config.root.startsWith("./")) {
					config.root = path.resolve( path.join( path.dirname(extensionsJson), config.root.replace(/^\.\//, "") ) );
				}
			}
		}

		// Read main.py file and parse it
		if ( (config.parsed === null || config.parsed === undefined || config.parsed.length < 1) && config.sourceFile !== null && config.sourceFile !== undefined) {
			const mainContent = fs.readFileSync(config.sourceFile, 'utf-8');
			if (mainContent) {
				config.parsed = parsePythonSource(mainContent);
			}
		}

		// Register hover
		vscode.languages.registerHoverProvider("python", {

			provideHover(document, position, token) {

				if ( !(config.disableFromRoot == true && path.dirname(document.uri.fsPath) == config.root) ) {

					// Get word information
					const range = document.getWordRangeAtPosition(position);
					const word = document.getText(range);
					const wordMapped = config.mapping.hasOwnProperty(word) ? config.mapping[word] : word;

					const beforeRange = new vscode.Range(position.line,0, position.line, range.start.character);
					const beforeWord = document.getText(beforeRange).split(/[^a-zA-Z0-9_\.]+/g).reverse()[0].replace(/\.*$/,'');
					const beforeWordMapped = config.mapping.hasOwnProperty(beforeWord) ? config.mapping[beforeWord] : beforeWord;

					// Get from parsed
					let obj;
					if (config.parsed.hasOwnProperty(wordMapped) && !config.blockedUnmappedDefs.includes(word) && !config.blockedDefs.includes(wordMapped)) {
						obj = config.parsed[wordMapped];
					} else if (config.parsed.hasOwnProperty(beforeWordMapped) && !config.blockedUnmappedDefs.includes(beforeWord) && !config.blockedDefs.includes(beforeWordMapped)) {
						if (wordMapped && wordMapped !== "" && !config.blockedUnmappedDefs.includes(word) && !config.blockedDefs.includes(wordMapped)) {
							if (config.parsed[beforeWordMapped].hasOwnProperty(wordMapped)) {
								obj = config.parsed[beforeWordMapped][wordMapped];
							}
						} else {
							obj = config.parsed[beforeWordMapped];
						}
					}

					// Display
					const markdown = new vscode.MarkdownString(``, true);

					if (obj) {
						let paramStr = ``;
						let descString = ``;
						obj.__parameters__.forEach(param => {
							paramStr += `${param.name}`;
							if (param.typeHint !== null) {
								paramStr += `: ${param.typeHint}`;
							}
							if (param.defaultValue !== null) {
								paramStr += ` = ${param.defaultValue}`;
							}
							paramStr += ", ";
						});
						paramStr = paramStr.replace(/, $/, "");
						if (obj.__description__ != "") {
							descString = `*${obj.__description__}*`;
						}
						markdown.appendCodeblock( `${obj.__def__} ${obj.__name__}(${paramStr})` ,activeEditor.document.languageId);
						markdown.appendMarkdown(`${descString}\n\n<span style="color:#94A;"><br>🛠️Text inserted by CrshModulo-Helper</span>`);
					}

					markdown.isTrusted = true;
					return new vscode.Hover(markdown);
				} else {
					if (config.msgOnRootDisabled === true) {
						const markdown = new vscode.MarkdownString(``, true);
						markdown.appendMarkdown(`<span style="color:#A62;"><br>🚧Helper disabled in crsh-root directory.</span>`);
						markdown.isTrusted = true;
						return new vscode.Hover(markdown);
					}
					return null;
				}
			}
		
		});

		function paramCompleter_fabricator(cutLinePrefix=false) {
			return {
				provideCompletionItems(document, position, token) {
					// Get the current line of text up to the cursor position
					let usedPrefix;
					const linePrefix = parseLastMethod( document.lineAt(position).text.substr(0, position.character) );
					if (cutLinePrefix == true) {
						usedPrefix = linePrefix.includes("(") ? cutAndRejoin(linePrefix)+"(" : linePrefix;
					} else {
						usedPrefix = linePrefix;
					}
	
					// Define the list of completion items for csSession
					let obj;
					for (const key of Object.keys(config.parsed)) {
						let mappedKey = key;
						for (const [key2,value] of Object.entries(config.mapping)) {
							if (value === key) {
								mappedKey = key2;
							}
						}
						if (usedPrefix.endsWith(mappedKey+"(")) {
							obj = config.parsed[key];
						} else {
							for (const childKey of Object.keys(config.parsed[key])) {
								let mappedChildKey = childKey;
								for (const [key3,value2] of Object.entries(config.mapping)) {
									if (value2 === childKey) {
										mappedChildKey = key3;
									}
								}
								if (usedPrefix.endsWith(mappedKey+"."+mappedChildKey+"(")) {
									obj = config.parsed[key][childKey];
								}
							}
						}
					}
					if (obj && obj !== null && obj !== undefined) {
						let completions = [];
						let defaultedCompletions = [];
						obj.__parameters__.forEach(param => {
							completions.push( new vscode.CompletionItem(`${param.name}=`, vscode.CompletionItemKind.Variable) );
							if (param.defaultValue !== null && config.addParamDefaults === true) {
								defaultedCompletions.push( new vscode.CompletionItem(`${param.name}=${param.defaultValue}`, vscode.CompletionItemKind.Value) );
							}
						});
						return completions.concat(defaultedCompletions);
					} else {
						return undefined;
					}
				}
			}
		}

		// Register completions
		const paramProviderFirst = vscode.languages.registerCompletionItemProvider(
			activeEditor.document.languageId,
			paramCompleter_fabricator(false),
			'('
		);

		const paramProviderSecondary = vscode.languages.registerCompletionItemProvider(
			activeEditor.document.languageId,
			paramCompleter_fabricator(true),
			','
		);

		const submethodProvider = vscode.languages.registerCompletionItemProvider(
			activeEditor.document.languageId,
			{
				provideCompletionItems(document, position, token) {
					// Get the current line of text up to the cursor position
					const linePrefix = parseLastMethod( document.lineAt(position).text.substr(0, position.character) );
	
					// Define the list of completion items for csSession
					let obj;
					for (const key of Object.keys(config.parsed)) {
						let mappedKey = key;
						for (const [key2,value] of Object.entries(config.mapping)) {
							if (value === key) {
								mappedKey = key2;
							}
						}
						if (linePrefix.endsWith(mappedKey+".")) {
							obj = config.parsed[key];
						} else {
							for (const childKey of Object.keys(config.parsed[mappedKey])) {
								let mappedChildKey = childKey;
								for (const [key3,value2] of Object.entries(config.mapping)) {
									if (value2 === childKey) {
										mappedChildKey = key3;
									}
								}
								if (linePrefix.endsWith(mappedKey+"."+mappedChildKey+".")) {
									obj = config.parsed[key][childKey];
								}
							}
						}
					}
					if (obj && obj !== null && obj !== undefined) {
						let completions = [];
						for (const prop of Object.keys(obj)) {
							if (!config.generatedKeys.includes(prop)) {
								completions.push( new vscode.CompletionItem(prop, vscode.CompletionItemKind.Method) );
							}
						}
						return completions;
					} else {
						return undefined;
					}
				}
			},
			'.'
		);
		
		context.subscriptions.push(paramProviderFirst);
		context.subscriptions.push(paramProviderSecondary);
		context.subscriptions.push(submethodProvider);
	}
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
