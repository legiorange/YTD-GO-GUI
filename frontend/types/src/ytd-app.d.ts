import { LitElement } from 'lit';
export declare class YtdApp extends LitElement {
    private currentView;
    private theme;
    private url;
    private videoDetails;
    private tasks;
    private history;
    private downloadPath;
    static styles: import("lit").CSSResult;
    firstUpdated(): Promise<void>;
    applyTheme(): void;
    startDownload(url: string, title: string, thumb: string): Promise<void>;
    refreshHistory(): Promise<void>;
    render(): import("lit-html").TemplateResult<1>;
    private renderSingle;
    private renderTasks;
    private renderHistory;
    private renderSettings;
}
