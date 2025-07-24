#!/usr/bin/env bash

# Script: md-tight-lists.sh
# Purpose: Reformat Markdown files to have tight lists (no empty lines between items)
# Usage: md-tight-lists.sh [OPTIONS] [file1.md file2.md ...]
#        cat file.md | md-tight-lists.sh [OPTIONS]

# Default values
use_mdformat=0

# Function to show usage
show_usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS] [file1.md file2.md ...]
       cat file.md | $(basename "$0") [OPTIONS]

Reformat Markdown files to have tight lists (no empty lines between list items).
When no files are provided, acts as a pipe filter reading from stdin.

OPTIONS:
    -h, --help      Show this help message and exit
    -f, --format    Also run output through mdformat (CommonMark formatter)
                    if available on PATH

EXAMPLES:
    # Process files in-place
    $(basename "$0") document1.md document2.md
    
    # Process all .md files in current directory
    $(basename "$0") *.md
    
    # Use as a pipe filter
    cat README.md | $(basename "$0") > README_clean.md
    
    # Process and format with mdformat
    $(basename "$0") -f document.md
    
    # Pipe with formatting
    pbpaste | $(basename "$0") --format | pbcopy

EOF
}

# Function to process markdown content
process_markdown() {
    awk '
    BEGIN {
        in_frontmatter = 0
        frontmatter_ended = 0
    }
    
    # Handle frontmatter
    NR == 1 && /^---$/ {
        in_frontmatter = 1
        print
        next
    }
    
    in_frontmatter && /^---$/ {
        in_frontmatter = 0
        frontmatter_ended = 1
        print
        next
    }
    
    in_frontmatter {
        print
        next
    }
    
    # Regular processing after frontmatter
    /^[[:space:]]*[-*+][[:space:]]/ || /^[[:space:]]*[0-9]+\.[[:space:]]/ {
        # This is a list item (list marker followed by space)
        if (!in_list && NR > 1 && last_line != "") {
            print ""  # Add empty line before list block
        }
        in_list = 1
        print
        next
    }
    {
        # Not a list item
        if (in_list && $0 != "") {
            print ""  # Add empty line after list block
            in_list = 0
        }
        if ($0 != "" || !in_list) {
            print
        }
    }
    {
        last_line = $0
    }
    '
}

# Function to process and optionally format
process_with_options() {
    if [ "$use_mdformat" -eq 1 ]; then
        if ! command -v mdformat >/dev/null 2>&1; then
            echo "Error: mdformat not found in PATH. Install it with: pip install mdformat" >&2
            echo "Continuing without formatting..." >&2
            process_markdown
        else
            process_markdown | mdformat -
        fi
    else
        process_markdown
    fi
}

# Parse options
files=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            show_usage
            exit 0
            ;;
        -f|--format)
            use_mdformat=1
            shift
            ;;
        -*)
            echo "Error: Unknown option: $1" >&2
            echo "Use -h or --help for usage information." >&2
            exit 1
            ;;
        *)
            files+=("$1")
            shift
            ;;
    esac
done

# If no files specified, act as a pipe filter
if [ ${#files[@]} -eq 0 ]; then
    process_with_options
    exit 0
fi

# Process files
for file in "${files[@]}"; do
    # Check if file exists
    if [ ! -f "$file" ]; then
        echo "Warning: '$file' not found, skipping..." >&2
        continue
    fi
    
    # Check if file has .md extension
    if [[ ! "$file" =~ \.md$ ]]; then
        echo "Warning: '$file' is not a .md file, skipping..." >&2
        continue
    fi
    
    # Create temporary file
    tmpfile=$(mktemp)
    
    # Process the file
    if process_with_options < "$file" > "$tmpfile"; then
        # Replace original file with processed version
        mv "$tmpfile" "$file"
        echo "✓ Processed: $file" >&2
    else
        # Remove temp file on error
        rm -f "$tmpfile"
        echo "✗ Error processing: $file" >&2
    fi
done