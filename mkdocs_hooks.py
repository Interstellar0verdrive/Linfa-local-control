"""Keep raw HTML step links usable in the MkDocs site."""

import posixpath
import re
from html import unescape

from mkdocs.utils import get_relative_url


STEP_NAV = re.compile(r'(<table width="100%" class="step-nav">)(.*?)(</table>)', re.DOTALL)
LINK = re.compile(r'href="([^"]+\.md)"')


def on_page_markdown(markdown, page, config, files):
    def rewrite_table(match):
        def rewrite_link(link):
            source_path = posixpath.normpath(
                posixpath.join(posixpath.dirname(page.file.src_uri), unescape(link.group(1)))
            )
            target = files.get_file_from_path(source_path)
            if target is None:
                raise ValueError(f"Step navigation target not found: {source_path}")
            return f'href="{get_relative_url(target.url or "/", page.url)}"'

        return match.group(1) + LINK.sub(rewrite_link, match.group(2)) + match.group(3)

    return STEP_NAV.sub(rewrite_table, markdown)
