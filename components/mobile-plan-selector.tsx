"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowUpRightIcon } from "./morrow-icons";

export interface MobilePlanTab {
  id: string;
  name: string;
}

export function MobilePlanSelector({
  title,
  plans,
  activePlanId,
  billingInterval,
  children,
}: {
  title: string;
  plans: MobilePlanTab[];
  activePlanId: string;
  billingInterval: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    dialogRef.current?.close();
  }, [activePlanId, billingInterval]);

  function openModal() {
    setActiveIndex(0);
    dialogRef.current?.showModal();
    requestAnimationFrame(() => {
      if (carouselRef.current) {
        carouselRef.current.scrollLeft = 0;
      }
      closeButtonRef.current?.focus({ preventScroll: true });
    });
  }

  function scrollToCard(index: number) {
    const container = carouselRef.current;
    if (!container) return;
    const cards = container.querySelectorAll<HTMLElement>(":scope > article");
    const target = cards[index];
    if (!target) return;
    setActiveIndex(index);
    target.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }

  function handleScroll() {
    const container = carouselRef.current;
    if (!container) return;
    const cards = Array.from(
      container.querySelectorAll<HTMLElement>(":scope > article"),
    );
    if (cards.length === 0) return;
    const containerCenter = container.scrollLeft + container.clientWidth / 2;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    cards.forEach((card, index) => {
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const distance = Math.abs(cardCenter - containerCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    setActiveIndex(closestIndex);
  }

  return (
    <>
      <button
        type="button"
        className="workspace-link billing-change-plan-link"
        aria-haspopup="dialog"
        onClick={openModal}
      >
        Change plan
        <ArrowUpRightIcon />
      </button>

      <dialog
        ref={dialogRef}
        className="billing-plan-dialog"
        aria-labelledby={titleId}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            event.currentTarget.close();
          }
        }}
      >
        <div className="workspace-panel-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            ref={closeButtonRef}
            className="workspace-panel-close"
            type="button"
            aria-label={`Close ${title}`}
            onClick={() => dialogRef.current?.close()}
          >
            ×
          </button>
        </div>

        <div className="billing-plan-dialog-body">
          {plans.length > 1 ? (
            <div
              className="billing-plan-tabs"
              role="tablist"
              aria-label="Other available plans"
            >
              {plans.map((plan, index) => (
                <button
                  key={plan.id}
                  type="button"
                  role="tab"
                  aria-selected={activeIndex === index}
                  className={`billing-plan-tab${
                    activeIndex === index ? " is-active" : ""
                  }`}
                  onClick={() => scrollToCard(index)}
                >
                  {plan.name}
                </button>
              ))}
            </div>
          ) : null}

          <div
            ref={carouselRef}
            className="billing-plan-carousel"
            onScroll={handleScroll}
          >
            {children}
          </div>
        </div>
      </dialog>
    </>
  );
}
