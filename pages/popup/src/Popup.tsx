import '@src/Popup.css';
import { withErrorBoundary, withSuspense } from '@extension/shared';
import { ErrorDisplay, LoadingSpinner } from '@extension/ui';
import { useEffect, useState } from 'react';

// 存储在 chrome.storage.local 里的键名：待办列表。
const STORAGE_KEY = 'pendingTodos';
// 存储在 chrome.storage.local 里的键名：是否允许执行“处理待办”。
const PROCESS_ENABLED_KEY = 'pendingReadSuccess';
// 只读取标题以该前缀开头的待办，避免抓到无关流程。
const TODO_PREFIX = '【履职通讯费报销】';
// 仅用于文案展示（提示语里的人类可读名称）。
const TODO_NAME = '履职通讯费报销';
// 通知图标路径：由扩展运行时生成可访问 URL。
const NOTIFICATION_ICON = chrome.runtime.getURL('icon-34.png');

// 统一封装浏览器通知，减少重复代码。
const notify = (title: string, message: string) => {
  // create 返回 Promise，这里不关心返回值，用 void 明确“忽略”。
  void chrome.notifications.create({
    type: 'basic',
    iconUrl: NOTIFICATION_ICON,
    title,
    message,
  });
};

const Popup = () => {
  // 底部状态栏文案。
  const [status, setStatus] = useState('准备就绪');
  // 是否允许点击“处理待办”按钮。
  const [canProcessPending, setCanProcessPending] = useState(false);

  useEffect(() => {
    // 组件打开时，恢复上一次“读取待办”的状态，保证按钮状态和缓存一致。
    const initGlobalProcessState = async () => {
      const result = await chrome.storage.local.get([STORAGE_KEY, PROCESS_ENABLED_KEY]);
      const canProcess = Boolean(result[PROCESS_ENABLED_KEY]);
      // 防御性处理：只接受数组，避免异常数据导致崩溃。
      const pendingTodos = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];

      setCanProcessPending(canProcess);
      if (canProcess) {
        setStatus(`可处理待办（已读取 ${pendingTodos.length} 条）`);
      }
    };

    void initGlobalProcessState();
  }, []);

  const readPending = async () => {
    try {
      // 只在“当前窗口 + 当前激活标签页”执行抓取。
      const [tab] = await chrome.tabs.query({ currentWindow: true, active: true });

      if (!tab?.id) {
        const message = '未找到当前页面标签';
        setStatus(message);
        setCanProcessPending(false);
        await chrome.storage.local.set({ [PROCESS_ENABLED_KEY]: false });
        notify('读取待办', message);
        return;
      }

      // 在页面上下文执行脚本：直接读取目标系统表格里的待办数据。
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [TODO_PREFIX],
        func: prefix => {
          // 标题比对前先去空白，降低页面格式差异带来的误判。
          const prefixNormalized = prefix.replace(/\s+/g, '');
          // AUI 表格中，每个 tr.aui-grid-body__row 对应一条待办。
          const rows = Array.from(
            document.querySelectorAll('table.aui-grid__body tbody tr.aui-grid-body__row'),
          );

          // 读取指定列文本（按 data-colid 定位），并做基础清洗。
          const getCellText = (row: Element, colId: string) =>
            (
              row.querySelector(`td[data-colid="${colId}"] .aui-grid-cell`)?.textContent ||
              ''
            )
              .replace(/\s+/g, ' ')
              .trim();

          // 标题列有时在 form-text-control，有时是普通网格单元，做兼容。
          const getTitleText = (row: Element) =>
            (
              row.querySelector('td[data-colid="col_2"] .form-text-control')?.textContent ||
              getCellText(row, 'col_2')
            )
              .replace(/\s+/g, ' ')
              .trim();

          // 先标准化每行，再按标题前缀过滤，最后去掉仅用于筛选的中间字段。
          return rows
            .map(row => {
              const title = getTitleText(row);
              const titleNormalized = title.replace(/\s+/g, '');

              return {
                rowId: row.getAttribute('data-rowid') || null,
                title,
                titleNormalized,
                billCode: getCellText(row, 'col_3'),
                currentStep: getCellText(row, 'col_4'),
                businessNo: getCellText(row, 'col_5'),
                applicant: getCellText(row, 'col_6'),
                applyDate: getCellText(row, 'col_7'),
              };
            })
            .filter(item => item.titleNormalized.startsWith(prefixNormalized))
            .map(({ titleNormalized, ...rest }) => rest);
        },
      });

      // 脚本执行结果做兜底，确保后续逻辑只处理数组。
      const pendingTodos = Array.isArray(result) ? result : [];
      // 读取成功后：缓存结果 + 打开“可处理”开关。
      await chrome.storage.local.set({
        [STORAGE_KEY]: pendingTodos,
        [PROCESS_ENABLED_KEY]: true,
      });

      const message = `已成功读取到${pendingTodos.length}个${TODO_NAME}待办`;
      setStatus(message);
      setCanProcessPending(true);
      notify('读取待办', message);
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取待办失败';
      setStatus(message);
      setCanProcessPending(false);
      // 读取失败时显式关闭“可处理”开关，防止使用旧缓存误处理。
      await chrome.storage.local.set({ [PROCESS_ENABLED_KEY]: false });
      notify('读取待办', message);
    }
  };

  const processPending = async () => {
    // 每次处理前重新读取全局状态，避免 UI 状态与存储状态不一致。
    const processState = await chrome.storage.local.get([PROCESS_ENABLED_KEY, STORAGE_KEY]);
    const globalProcessEnabled = Boolean(processState[PROCESS_ENABLED_KEY]);
    const pendingTodos = Array.isArray(processState[STORAGE_KEY]) ? processState[STORAGE_KEY] : [];

    if (!globalProcessEnabled) {
      const blockedMessage = '请先成功读取待办后再处理';
      setStatus(blockedMessage);
      notify('处理待办', blockedMessage);
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({ currentWindow: true, active: true });
      if (!tab?.id) {
        const message = '未找到当前页面标签';
        setStatus(message);
        notify('处理待办', message);
        return;
      }

      // 在当前详情页提取结构化数据（摘要字段 + 多个表格区块）。
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // 标准化文本：压缩空白并 trim，便于稳定比较与导出。
          const normalize = (value: string) => (value || '').replace(/\s+/g, ' ').trim();
          // 作为“键”时进一步去掉所有空白，规避 UI 文案换行/空格差异。
          const normalizeKey = (value: string) => (value || '').replace(/\s+/g, '').trim();
          // 安全读取节点文本。
          const getText = (el: Element | null) => normalize(el?.textContent || '');

          // 通用字段读取：通过根 id 找到该表单项，再按多个候选选择器尝试取值。
          // 原因：同一业务系统在不同字段上常用不同渲染结构。
          const getFieldById = (id: string) => {
            const root = document.getElementById(id);
            if (!root) return '';

            // 候选选择器从“更具体”到“更泛化”，命中即返回。
            const candidates = [
              '.aui-input-display-only__content',
              '.render-only',
              '.aui-tooltip.render-only',
              '[data-tag="numeric-display-only"] span',
              '[data-tag="aui-form-item-show"] .aui-tooltip',
              '[data-tag="aui-form-item-show"] span.absolute',
              '[data-tag="aui-form-item-show"]',
            ];

            for (const selector of candidates) {
              const node = root.querySelector(selector);
              const text = getText(node);
              // 找到第一个非空文本就结束，避免被后续选择器覆盖。
              if (text) return text;
            }
            return '';
          };

          // 解析页面顶部摘要区（例如“单据编号/报销金额/核定金额”）。
          const extractSummaryMap = () => {
            const map: Record<string, string> = {};
            const summarySpans = Array.from(
              document.querySelectorAll(
                'div.font-normal.text-sm.color-text-primary.leading-5.inline-flex.flex-row > span',
              ),
            );

            for (const span of summarySpans) {
              // 摘要区常见格式是“第一行键名 + 后续行值”，这里统一拆分处理。
              const lines = (span.textContent || '')
                .split(/\n+/)
                .map(s => normalize(s))
                .filter(Boolean);

              if (lines.length >= 2) {
                const key = normalizeKey(lines[0]);
                // 多行值合并为空格分隔的一行文本，便于导出查看。
                map[key] = lines.slice(1).join(' ');
              }
            }

            return map;
          };

          // 通过区块标题文本定位对应版块（用于后续提取该版块表格）。
          const findSectionTitleNode = (title: string) => {
            const target = normalizeKey(title);
            return Array.from(document.querySelectorAll('div.flex-1.font-bold.text-sm.truncate')).find(
              el => normalizeKey(getText(el as Element)) === target,
            ) as Element | undefined;
          };

          // 从指定区块中提取 grid 表头和数据行，输出为“对象数组”。
          const extractGridFromSection = (sectionTitle: string) => {
            const titleNode = findSectionTitleNode(sectionTitle);
            if (!titleNode) return [];

            // 不同页面版本 DOM 层级可能不同，使用多种回溯路径提高兼容性。
            const sectionRoot =
              titleNode.closest('div.sm\\:p-0.space-y-2') ||
              titleNode.closest('div.space-y-2') ||
              titleNode.parentElement?.parentElement;

            if (!sectionRoot) return [];

            const headerTable = sectionRoot.querySelector('table.aui-grid__header');
            const bodyTable = sectionRoot.querySelector('table.aui-grid__body');
            if (!headerTable || !bodyTable) return [];

            // colId -> 列名 的映射。后续读取每个 td 时用它生成可读键。
            const headerMap = new Map<string, string>();
            // 处理重名列：例如多个“金额”，会自动变成 金额_2、金额_3。
            const seenHeaders = new Map<string, number>();

            for (const th of Array.from(headerTable.querySelectorAll('th[data-colid]'))) {
              const colId = th.getAttribute('data-colid') || '';
              const name =
                getText(th.querySelector('.aui-grid-cell-text')) || getText(th.querySelector('.aui-grid-cell')) || colId;
              const count = seenHeaders.get(name) || 0;
              seenHeaders.set(name, count + 1);
              const uniqueName = count === 0 ? name : `${name}_${count + 1}`;
              headerMap.set(colId, uniqueName);
            }

            // 逐行读取表格内容，最终产出 Record<string, string>[]。
            const rows: Record<string, string>[] = [];
            for (const tr of Array.from(bodyTable.querySelectorAll('tr.aui-grid-body__row'))) {
              const item: Record<string, string> = {};
              for (const td of Array.from(tr.querySelectorAll('td[data-colid]'))) {
                const colId = td.getAttribute('data-colid') || '';
                const key = headerMap.get(colId) || colId;
                item[key] = getText(td.querySelector('.aui-grid-cell'));
              }
              // 全空行直接丢弃，减少无效数据。
              if (Object.values(item).some(Boolean)) rows.push(item);
            }

            return rows;
          };

          // 汇总页面主要字段，字段名直接使用中文，导出后更直观。
          const summary = extractSummaryMap();
          return {
            单据标题: getText(document.querySelector('.detail-title')),
            单据编号: summary['单据编号'] || '',
            报销金额: summary['报销金额'] || '',
            核定金额: summary['核定金额'] || '',
            支付金额: summary['支付金额'] || '',
            管理单元: getFieldById('unitCode'),
            单据日期: getFieldById('documentDate'),
            经办人: getFieldById('operator'),
            经办人电话: getFieldById('operatorTel'),
            立项单号: getFieldById('bgtDocumentId'),
            报销部门: getFieldById('applicantDeptCode'),
            业务归口部门: getFieldById('businessDeptCode'),
            业务事项: getFieldById('businessMatters'),
            费用承担部门: getFieldById('expenseDeptCode'),
            币种: getFieldById('currencyCode'),
            周期类型: getFieldById('periodType'),
            是否会签: getFieldById('counterSignFlag'),
            会签l领导: getFieldById('countersignUserLabel'),
            会签部门: getFieldById('countersignDeptLabel'),
            附件张数: getFieldById('attachCount'),
            事由: getFieldById('remark'),
            读取列表: {
              费用明细: extractGridFromSection('费用明细'),
              借款核销信息: extractGridFromSection('借款核销信息'),
              支付信息: extractGridFromSection('支付信息'),
              审批记录: extractGridFromSection('审批记录'),
            },
          };
        },
      });

      // 生成文件名时间戳：替换掉文件名不友好的字符（: 和 .）。
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      // 导出结构：包含“读取到的待办列表” + “当前详情页提取数据”。
      const exportData = {
        exportedAt: new Date().toISOString(),
        pendingCount: pendingTodos.length,
        pendingTodos,
        currentPageTodo: result || {},
      };

      // 生成可下载 JSON 文件。
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);

      // 触发浏览器下载。saveAs=true 会弹出保存对话框。
      await chrome.downloads.download({
        url,
        filename: `待办信息_${timestamp}.json`,
        saveAs: true,
      });

      // 释放临时 URL，避免内存长期占用。
      setTimeout(() => URL.revokeObjectURL(url), 30000);

      const successMessage = `已成功导出${pendingTodos.length}条待办信息JSON`;
      setStatus(successMessage);
      notify('处理待办', successMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理待办失败';
      setStatus(message);
      notify('处理待办', message);
    }
  };

  return (
    // Popup 结构：标题区 + 操作区 + 状态区。
    <div className="popup-shell">
      <header className="popup-header">
        <h1>通讯费报销自动审批插件</h1>
        <p>请选择要执行的操作</p>
      </header>

      <main className="popup-actions">
        <button className="action-button action-button-read" onClick={readPending}>
          读取待办
        </button>
        {/* 只有“读取待办”成功后才允许处理，避免导出空或旧数据。 */}
        <button
          className="action-button action-button-process"
          onClick={processPending}
          disabled={!canProcessPending}>
          处理待办
        </button>
      </main>

      <footer className="popup-status" aria-live="polite">
        {status}
      </footer>
    </div>
  );
};

// 用 Suspense 和错误边界包裹，保证加载和异常场景都有可见反馈。
export default withErrorBoundary(withSuspense(Popup, <LoadingSpinner />), ErrorDisplay);
