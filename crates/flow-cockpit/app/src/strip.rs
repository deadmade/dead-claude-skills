//! A view's TypeScript to the JavaScript the window imports: types stripped, everything else left as written (no
//! lowering: the webview runs current JavaScript).
//!
//! A view gets everything through `ctx`, so it may import types only. A value import, a re-export, a dynamic
//! `import()` or an `import x = …` would load code from outside the views' interface, and fails here with its line.

use std::path::Path;

use oxc_allocator::Allocator;
use oxc_ast::AstKind;
use oxc_ast::ast::{ImportDeclarationSpecifier, Statement};
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::{LabeledSpan, SourceType, Span};
use oxc_transformer::{TransformOptions, Transformer};

/// Strips the types from a view's source.
///
/// # Errors
/// A syntax error, or a value `import`, as `line N: message`.
pub fn strip(source: &str) -> Result<String, String> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    let report = |offset: u32, message: &str| format!("line {}: {message}", line(source, offset));
    if let Some(error) = parsed.diagnostics.first() {
        let at = error.labels.first().map_or(0, LabeledSpan::offset);
        return Err(report(at, &error.message));
    }
    let mut program = parsed.program;
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .build(&program)
        .semantic;
    // Statements first, then `import()` and `import x = …` anywhere in the code; the earliest one is reported.
    let nested = semantic.nodes().iter().find_map(|node| match node.kind() {
        AstKind::ImportExpression(import) => Some(import.span),
        AstKind::TSImportEqualsDeclaration(import) if import.import_kind.is_value() => {
            Some(import.span)
        }
        _ => None,
    });
    let first = program
        .body
        .iter()
        .find_map(value_import)
        .into_iter()
        .chain(nested)
        .min_by_key(|span| span.start);
    if let Some(span) = first {
        return Err(report(
            span.start,
            "a view may only `import type`; it gets everything else through ctx",
        ));
    }
    let scoping = semantic.into_scoping();
    let options = TransformOptions::default();
    let transformed = Transformer::new(&allocator, Path::new("view.ts"), &options)
        .build_with_scoping(scoping, &mut program);
    if let Some(error) = transformed.diagnostics.first() {
        let at = error.labels.first().map_or(0, LabeledSpan::offset);
        return Err(report(at, &error.message));
    }
    Ok(Codegen::new().build(&program).code)
}

/// The span of a statement that loads another module's values: an `import` that isn't all types (a bare
/// `import 'x'` included), or a value `export … from`.
fn value_import(statement: &Statement<'_>) -> Option<Span> {
    match statement {
        Statement::ImportDeclaration(import) => {
            let values = import.import_kind.is_value()
                && import.specifiers.as_ref().is_none_or(|specifiers| {
                    specifiers.is_empty()
                        || specifiers.iter().any(|s| match s {
                            ImportDeclarationSpecifier::ImportSpecifier(s) => {
                                s.import_kind.is_value()
                            }
                            _ => true,
                        })
                });
            values.then_some(import.span)
        }
        Statement::ExportFromDeclaration(export) => (export.export_kind.is_value()
            && (export.specifiers.is_empty()
                || export.specifiers.iter().any(|s| s.export_kind.is_value())))
        .then_some(export.span),
        Statement::ExportAllDeclaration(export) => {
            export.export_kind.is_value().then_some(export.span)
        }
        _ => None,
    }
}

/// The 1-based line of a byte offset.
fn line(source: &str, offset: u32) -> usize {
    let end = usize::try_from(offset).map_or(source.len(), |o| o.min(source.len()));
    source.as_bytes()[..end].split(|&b| b == b'\n').count()
}

#[cfg(test)]
mod tests {
    use super::*;

    const VIEW: &str = r"import type { View, ViewContext } from './flow-cockpit';

interface Row {
  name: string;
}

class Counter {
  count: number = 0;
  #hidden = 1;
}

function label(row?: Row): string {
  return row?.name ?? 'none';
}

const view: View = {
  id: 'list',
  title: 'List',
  slot: 'list',
  render(ctx: ViewContext) {
    return document.createTextNode(label() + new Counter().count);
  },
};

export default view;
";

    #[test]
    fn strip_keeps_es_syntax() {
        let js = strip(VIEW).unwrap();
        for kept in [
            "row?.name",
            "count = 0",
            "#hidden = 1",
            "export default view",
        ] {
            assert!(js.contains(kept), "{kept} missing from:\n{js}");
        }
        for gone in [
            "interface",
            "import",
            ": string",
            ": View",
            ": ViewContext",
            ": number",
        ] {
            assert!(!js.contains(gone), "{gone} left in:\n{js}");
        }
    }

    #[test]
    fn value_import_is_an_error() {
        let src = "import type { View } from './flow-cockpit';\n\nimport { marked } from './marked.js';\nexport default {} as View;\n";
        let err = strip(src).unwrap_err();
        assert!(err.starts_with("line 3:"), "{err}");
        assert!(err.contains("import type"), "{err}");
    }

    #[test]
    fn side_effect_import_and_re_export_are_errors() {
        assert!(
            strip("import './x.js';\n")
                .unwrap_err()
                .starts_with("line 1:")
        );
        assert!(
            strip("const a = 1;\nexport { b } from './x.js';\n")
                .unwrap_err()
                .starts_with("line 2:")
        );
        assert!(strip("export type { V } from './x';\n").is_ok());
    }

    #[test]
    fn dynamic_import_is_an_error() {
        let err = strip("const a = 1;\nconst m = await import('./x.js');\nexport default m;\n")
            .unwrap_err();
        assert!(err.starts_with("line 2:"), "{err}");
        assert!(err.contains("import type"), "{err}");
    }

    #[test]
    fn import_require_is_an_error() {
        let err = strip("const a = 1;\n\nimport fs = require('fs');\n").unwrap_err();
        assert!(err.starts_with("line 3:"), "{err}");
        assert!(strip("import type T = require('./t');\n").is_ok());
    }

    #[test]
    fn strip_reports_syntax_errors() {
        let err = strip("const a = 1;\nconst b = ;\n").unwrap_err();
        assert!(err.starts_with("line 2:"), "{err}");
    }
}
