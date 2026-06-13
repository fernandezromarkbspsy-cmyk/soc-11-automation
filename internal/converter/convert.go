package converter

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

func PDFToPNG(ctx context.Context, pdfPath, pngPath string, dpi, maxWidth, borderPX int) error {
	if dpi <= 0 {
		dpi = 220
	}

	tmpDir := filepath.Join(filepath.Dir(pngPath), "pages")
	if err := os.MkdirAll(tmpDir, 0o755); err != nil {
		return err
	}
	prefix := filepath.Join(tmpDir, "page")

	pdftoppm := exec.CommandContext(ctx, "pdftoppm", "-png", "-r", fmt.Sprint(dpi), pdfPath, prefix)
	if output, err := pdftoppm.CombinedOutput(); err != nil {
		return fmt.Errorf("pdftoppm: %w: %s", err, strings.TrimSpace(string(output)))
	}

	pages, err := filepath.Glob(prefix + "-*.png")
	if err != nil {
		return err
	}
	if len(pages) == 0 {
		return fmt.Errorf("pdftoppm produced no PNG pages")
	}

	sort.Slice(pages, func(i, j int) bool {
		return pageNumber(pages[i]) < pageNumber(pages[j])
	})

	args := append([]string{}, pages...)
	if maxWidth > 0 {
		args = append(args, "-resize", fmt.Sprintf("%dx>", maxWidth))
	}
	args = append(
		args,
		"-background", "white",
		"-alpha", "remove",
		"-alpha", "off",
		"-fuzz", "1%",
		"-trim", "+repage",
		"-append",
		"-trim", "+repage",
	)
	if borderPX > 0 {
		margin := fmt.Sprintf("%dx%d", borderPX, borderPX)
		args = append(args, "-bordercolor", "white", "-border", margin)
	}
	args = append(args, "-strip", pngPath)

	binary := "magick"
	if _, err := exec.LookPath(binary); err != nil {
		binary = "convert"
	}
	cmd := exec.CommandContext(ctx, binary, args...)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%s: %w: %s", binary, err, strings.TrimSpace(string(output)))
	}
	return nil
}

func pageNumber(path string) int {
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	idx := strings.LastIndex(base, "-")
	if idx < 0 {
		return 0
	}
	n, err := strconv.Atoi(base[idx+1:])
	if err != nil {
		return 0
	}
	return n
}
