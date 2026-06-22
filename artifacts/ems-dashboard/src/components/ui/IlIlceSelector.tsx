import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { IL_NAMES, getIlceler } from "@/data/turkiyeIlIlce";
import { cn } from "@/lib/utils";

interface IlIlceSelectorProps {
  il: string;
  ilce: string;
  onIlChange: (il: string) => void;
  onIlceChange: (ilce: string) => void;
  ilLabel?: string;
  ilRequired?: boolean;
}

export function IlIlceSelector({ il, ilce, onIlChange, onIlceChange, ilLabel = "İl", ilRequired = false }: IlIlceSelectorProps) {
  const [open, setOpen] = useState(false);
  const ilceler = getIlceler(il);

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label>{ilLabel}{ilRequired ? " *" : ""}</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between font-normal bg-transparent border-input hover:bg-accent hover:text-accent-foreground"
            >
              <span className={cn("truncate", !il && "text-muted-foreground")}>
                {il || "İl seçin"}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="İl ara..." />
              <CommandList className="max-h-56">
                <CommandEmpty>İl bulunamadı.</CommandEmpty>
                <CommandGroup>
                  {IL_NAMES.map((name) => (
                    <CommandItem
                      key={name}
                      value={name}
                      onSelect={(val) => {
                        onIlChange(val === il ? "" : val);
                        onIlceChange("");
                        setOpen(false);
                      }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", il === name ? "opacity-100" : "opacity-0")} />
                      {name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div className="space-y-1.5">
        <Label>İlçe</Label>
        <Select value={ilce} onValueChange={onIlceChange} disabled={!il || ilceler.length === 0}>
          <SelectTrigger>
            <SelectValue placeholder="İlçe seçin" />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            {ilceler.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
