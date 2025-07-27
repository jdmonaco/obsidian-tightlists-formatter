#!/usr/bin/env bash

# Script: md-tight-lists.sh
# Purpose: Reformat Markdown files to have tight lists (no empty lines between items)
# Usage: md-tight-lists.sh [OPTIONS] [file1.md file2.md ...]
#        cat file.md | md-tight-lists.sh [OPTIONS]

# Function to show usage
show_usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS] [file1.md file2.md ...]
       cat file.md | $(basename "$0") [OPTIONS]

Reformat Markdown files to have tight lists (no empty lines between list items).
When no files are provided, acts as a pipe filter reading from stdin.

OPTIONS:
    -h, --help      Show this help message and exit

EXAMPLES:
    # Process files in-place
    $(basename "$0") document1.md document2.md
    
    # Process all .md files in current directory
    $(basename "$0") *.md
    
    # Use as a pipe filter
    cat README.md | $(basename "$0") > README_clean.md
    
    # Process clipboard content
    pbpaste | $(basename "$0") | pbcopy

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


# Parse options
files=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            show_usage
            exit 0
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
    process_markdown
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
    if process_markdown < "$file" > "$tmpfile"; then
        # Replace original file with processed version
        mv "$tmpfile" "$file"
        echo "✓ Processed: $file" >&2
    else
        # Remove temp file on error
        rm -f "$tmpfile"
        echo "✗ Error processing: $file" >&2
    fi
done

