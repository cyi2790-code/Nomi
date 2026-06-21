import React from "react";
import { MantineProvider, MantineThemeProvider } from "@mantine/core";
import { buildNomiTheme } from "../../theme/nomiTheme";

const DEFAULT_COLOR_SCHEME = "light";

export function MantineFeatureProvider({
    children,
}: {
    children: React.ReactNode;
}): JSX.Element {
    const theme = React.useMemo(() => buildNomiTheme(), []);

    return (
        <MantineProvider
            forceColorScheme={DEFAULT_COLOR_SCHEME}
            defaultColorScheme={DEFAULT_COLOR_SCHEME}>
            <MantineThemeProvider theme={theme}>
                {children}
            </MantineThemeProvider>
        </MantineProvider>
    );
}
