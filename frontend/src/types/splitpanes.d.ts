declare module 'splitpanes' {
  import { DefineComponent } from 'vue'
  
  export interface PaneProps {
    size?: number
    minSize?: number
    maxSize?: number
    class?: string
  }
  
  export interface SplitpanesProps {
    horizontal?: boolean
    pushOtherPanes?: boolean
    dblClickSplitter?: boolean
    rtl?: boolean
    firstSplitter?: boolean
  }
  
  export interface PaneResizeEvent {
    panes: { size: number }[]
  }
  
  export const Splitpanes: DefineComponent<SplitpanesProps>
  export const Pane: DefineComponent<PaneProps>
}
